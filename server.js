'use strict';
// Quanto — servidor Express.
// Modo live (claves de Bitvavo de solo lectura) o demo (datos de ejemplo).
const express = require('express');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { BitvavoClient } = require('./lib/bitvavo');
const { readJson, writeJson, ensureDir, exists } = require('./lib/store');
const { parseBitvavoHistory } = require('./lib/csv');
const { mergeOps, analyze, opFromAccountHistory } = require('./lib/history');
const { buildPortfolio, demoPortfolio, demoOps, demoEvolution, FALLBACK_PRICES } = require('./lib/portfolio');
const { taxReport, simulateSale, estimateTax } = require('./lib/tax');
const { evolutionSeries } = require('./lib/evolution');
const { getFearGreed } = require('./lib/feargreed');
const { hashPassword, verifyPassword, safeEqual, createToken, verifyToken, createLimiter } = require('./lib/auth');
const { round } = require('./lib/util');

const VERSION = '2.0.0';
const PORT = Number(process.env.PORT) || 8765;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SNAP_MIN = Math.max(1, Number(process.env.SNAP_INTERVAL_MIN) || 5);
const SNAP_MS = SNAP_MIN * 60e3;
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS) || 30);
const COOKIE_NAME = 'quanto_session';

ensureDir(DATA_DIR);

const FILES = {
  ops: path.join(DATA_DIR, 'bitvavo-history.json'),
  history: path.join(DATA_DIR, 'history.json'),
  holdings: path.join(DATA_DIR, 'holdings.json'),
  overrides: path.join(DATA_DIR, 'overrides.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
};

// ------------------------------------------------------------------ settings
function getSettings() { return readJson(FILES.settings, {}) || {}; }
function saveSettings(s) { writeJson(FILES.settings, s); }

function migrateSettings() {
  const s = getSettings();
  let changed = false;
  if (typeof s.password === 'string' && s.password) {
    s.password = Object.assign({ algo: 'scrypt' }, hashPassword(s.password));
    changed = true;
    console.log('[auth] contraseña antigua migrada a hash scrypt');
  }
  if (changed) saveSettings(s);
}
migrateSettings();

function ensurePassword() {
  const s = getSettings();
  if (s.password && s.password.hash) return;
  if ((process.env.APP_PASSWORD || '').trim()) return;
  const pw = crypto.randomBytes(9).toString('base64url');
  s.password = Object.assign({ algo: 'scrypt', generated: true, createdAt: Date.now() }, hashPassword(pw));
  saveSettings(s);
  console.log('================================================');
  console.log(' No hay APP_PASSWORD: contraseña generada');
  console.log('   ' + pw);
  console.log(' Cámbiala en Ajustes → Seguridad');
  console.log('================================================');
}
ensurePassword();

const COOKIE_SECRET = (() => {
  if (process.env.COOKIE_SECRET) return process.env.COOKIE_SECRET;
  const file = path.join(DATA_DIR, 'session-secret.txt');
  try {
    const old = fs.readFileSync(file, 'utf8').trim();
    if (old.length >= 32) return old;
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, secret); } catch {}
  return secret;
})();

function checkPassword(password) {
  const s = getSettings();
  if (s.password && s.password.hash) return verifyPassword(password, s.password);
  const env = (process.env.APP_PASSWORD || '').trim();
  return !!env && safeEqual(password, env);
}

// ------------------------------------------------------------------ estado
const client = new BitvavoClient();
const state = {
  mode: 'demo',
  ops: [],
  meta: { importedAt: null, autoCaptured: 0, lastSyncAt: null, source: null },
  analysis: null,
  portfolio: null,
  portfolioAt: 0,
  error: null,
  keysError: null,
  syncing: false,
  snapshots: [],
  prices: {},
  evolutionCache: { at: 0, day: '', data: null },
};

function loadOps() {
  const saved = readJson(FILES.ops, null);
  if (saved && Array.isArray(saved.ops)) {
    state.ops = saved.ops;
    state.meta = {
      importedAt: saved.importedAt || null,
      autoCaptured: saved.autoCaptured || 0,
      lastSyncAt: saved.lastSyncAt || null,
      source: saved.source || (saved.importedAt ? 'csv' : 'api'),
    };
  }
  state.snapshots = readJson(FILES.history, []);
  if (!Array.isArray(state.snapshots)) state.snapshots = [];
  refreshAnalysis();
}
function saveOps() {
  writeJson(FILES.ops, { ...state.meta, ops: state.ops });
}
function refreshAnalysis() {
  state.analysis = state.ops.length ? analyze(state.ops) : null;
}

function applyKeys() {
  const s = getSettings();
  const key = s.keysCleared ? '' : (s.apiKey || process.env.BITVAVO_API_KEY || '').trim();
  const secret = s.keysCleared ? '' : (s.apiSecret || process.env.BITVAVO_API_SECRET || '').trim();
  client.setKeys(key, secret);
  state.mode = client.configured ? 'live' : 'demo';
}

// ------------------------------------------------------------------ mercado
async function fetchMarket() {
  const [ticker, stats] = await Promise.all([client.tickerPrice(), client.ticker24h()]);
  const prices = {};
  const dayChange = {};
  for (const t of Array.isArray(ticker) ? ticker : []) {
    if (!t.market || !t.market.endsWith('-EUR')) continue;
    const price = parseFloat(t.price);
    if (isFinite(price) && price > 0) prices[t.market.slice(0, -4)] = price;
  }
  for (const t of Array.isArray(stats) ? stats : []) {
    if (!t.market || !t.market.endsWith('-EUR')) continue;
    const open = parseFloat(t.open);
    const last = parseFloat(t.last);
    if (open > 0 && last > 0) dayChange[t.market.slice(0, -4)] = ((last - open) / open) * 100;
  }
  return { prices, dayChange };
}

/**
 * Operaciones que usan las vistas de fiscal/operaciones/evolución.
 * En DEMO, si no hay historial real, se generan datos de ejemplo al vuelo
 * (nunca se guardan en disco).
 */
function opsForView() {
  if (state.ops.length) return state.ops;
  if (state.mode === 'demo') return demoOps(state.prices);
  return [];
}

// ------------------------------------------------------------------ sincronización
async function syncFromBitvavo({ force = false } = {}) {
  if (!client.configured) return { ok: false, reason: 'no-keys' };
  if (state.syncing) return { ok: false, reason: 'busy' };
  state.syncing = true;
  try {
    const res = await client.accountHistory(100);
    const items = Array.isArray(res && res.items) ? res.items : (Array.isArray(res) ? res : []);
    const incoming = items.map(opFromAccountHistory).filter(Boolean);
    const merged = mergeOps(state.ops, incoming);
    state.ops = merged.ops;
    refreshAnalysis();
    if (!state.meta.importedAt) state.meta.source = state.meta.source || 'api';
    state.meta.autoCaptured = (state.meta.autoCaptured || 0) + merged.added;
    state.meta.lastSyncAt = Date.now();
    if (merged.added || merged.enriched) saveOps();
    state.keysError = null;
    state.portfolioAt = 0;
    if (force || merged.added) console.log(`[sync] ${merged.added} operaciones nuevas (total ${state.ops.length})`);
    return { ok: true, added: merged.added, enriched: merged.enriched, total: state.ops.length, fetched: incoming.length };
  } catch (e) {
    state.keysError = e.message;
    console.log('[sync]', e.message);
    return { ok: false, error: e.message, status: e.status };
  } finally {
    state.syncing = false;
  }
}

// ------------------------------------------------------------------ cartera
async function refreshPortfolio(force = false) {
  const now = Date.now();
  if (!force && state.portfolio && now - state.portfolioAt < 20e3) return state.portfolio;
  try {
    let portfolio;
    if (state.mode === 'live') {
      const [market, balances] = await Promise.all([fetchMarket(), client.balance()]);
      state.prices = market.prices;
      portfolio = buildPortfolio({
        mode: 'live',
        balances: Array.isArray(balances) ? balances : [],
        prices: market.prices,
        dayChange: market.dayChange,
        analysis: state.analysis,
        holdings: readJson(FILES.holdings, {}) || {},
        overrides: readJson(FILES.overrides, {}) || {},
        importedAt: state.meta.importedAt,
        autoCaptured: state.meta.autoCaptured,
        lastSyncAt: state.meta.lastSyncAt,
      });
      state.keysError = null;
      state.error = null;
    } else if (state.ops.length) {
      // Sin claves pero con historial importado: mostramos la cartera reconstruida
      // del CSV (cantidades = comprado - vendido - retirado).
      let market = { prices: {}, dayChange: {} };
      try { market = await fetchMarket(); } catch {}
      state.prices = { ...FALLBACK_PRICES, ...market.prices };
      const balances = Object.entries(state.analysis.byCoin)
        .map(([symbol, g]) => ({ symbol, available: String(Math.max(0, round(g.bought - g.sold - g.withdrawn, 8))), inOrder: '0' }))
        .filter(b => Number(b.available) > 0);
      portfolio = buildPortfolio({
        mode: 'history',
        balances,
        prices: state.prices,
        dayChange: market.dayChange,
        analysis: state.analysis,
        holdings: readJson(FILES.holdings, {}) || {},
        overrides: readJson(FILES.overrides, {}) || {},
        importedAt: state.meta.importedAt,
        autoCaptured: state.meta.autoCaptured,
        lastSyncAt: state.meta.lastSyncAt,
      });
    } else {
      let market = { prices: {}, dayChange: {} };
      try { market = await fetchMarket(); } catch {}
      state.prices = { ...FALLBACK_PRICES, ...market.prices };
      portfolio = demoPortfolio(state.prices, market.dayChange);
    }
    state.portfolio = portfolio;
    state.portfolioAt = now;
    maybeSnapshot(portfolio);
    return portfolio;
  } catch (e) {
    state.error = e.message;
    state.keysError = e.status === 401 || e.status === 403 ? e.message : state.keysError;
    console.error('[cartera]', e.message);
    return state.portfolio;
  }
}

/** Modo que ve el usuario: live (claves), history (solo CSV) o demo. */
function effectiveMode() {
  if (state.mode === 'live') return 'live';
  return state.ops.length ? 'history' : 'demo';
}

// ------------------------------------------------------------------ histórico de valor
function maybeSnapshot(portfolio) {
  if (!portfolio) return;
  const last = state.snapshots[state.snapshots.length - 1];
  if (last && Date.now() - last.t < SNAP_MS - 5000) return;
  if (last && last.mode !== portfolio.mode) state.snapshots = [];
  state.snapshots.push({
    t: Date.now(),
    value: portfolio.totalValue,
    invested: portfolio.invested,
    pnl: portfolio.pnl,
    cash: portfolio.cash,
    mode: portfolio.mode,
  });
  compactSnapshots();
  writeJson(FILES.history, state.snapshots);
}

function compactSnapshots() {
  const MAX = 20000;
  if (state.snapshots.length <= MAX) return;
  const keep = state.snapshots.slice(-Math.floor(MAX / 2));
  const old = state.snapshots.slice(0, state.snapshots.length - keep.length);
  const buckets = new Map();
  for (const p of old) {
    const key = Math.floor(p.t / 3600e3);
    const b = buckets.get(key);
    if (!b) buckets.set(key, { ...p, _n: 1 });
    else { b.value += p.value; b.invested += p.invested; b.pnl += p.pnl; b.cash += p.cash; b._n++; }
  }
  const compacted = [...buckets.values()].map(b => ({
    t: b.t, mode: b.mode,
    value: round(b.value / b._n), invested: round(b.invested / b._n),
    pnl: round(b.pnl / b._n), cash: round(b.cash / b._n),
  }));
  state.snapshots = compacted.concat(keep);
}

// ------------------------------------------------------------------ express
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; " +
    "base-uri 'none'; form-action 'self'");
  next();
});

app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  const raw = req.headers.cookie || '';
  const match = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  req.session = match ? decodeURIComponent(match[1]) : null;
  next();
});

const limiter = createLimiter({ windowMs: 10 * 60e3, max: 8 });
const loginAttempts = new Map();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function setSessionCookie(req, res, token) {
  const secure = (req.secure || req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function requireAuth(req, res, next) {
  if (verifyToken(COOKIE_SECRET, req.session)) return next();
  res.status(401).json({ error: 'No autorizado', code: 'unauthorized' });
}

// ---------------- público ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }));

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    mode: effectiveMode(),
    configured: client.configured,
    hasPassword: !!(getSettings().password && getSettings().password.hash) || !!(process.env.APP_PASSWORD || '').trim(),
    imported: !!state.meta.importedAt,
  });
});

app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  const limit = limiter.check(ip);
  if (!limit.allowed) {
    return res.status(429).json({ error: `Demasiados intentos. Espera ${Math.ceil(limit.retryAfter / 60)} minutos.` });
  }
  const password = String((req.body && req.body.password) || '');
  if (!password) return res.status(400).json({ error: 'Falta la contraseña' });
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  limiter.reset(ip);
  setSessionCookie(req, res, createToken(COOKIE_SECRET, SESSION_DAYS * 86400e3));
  res.json({ ok: true });
});

// ---------------- privado ----------------
app.use('/api', requireAuth);

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => res.json({ ok: true }));

app.get('/api/overview', async (req, res) => {
  const portfolio = await refreshPortfolio(false);
  res.json({
    status: {
      version: VERSION,
      mode: effectiveMode(),
      configured: client.configured,
      keysError: state.keysError,
      error: state.error,
      syncing: state.syncing,
      lastSyncAt: state.meta.lastSyncAt,
      importedAt: state.meta.importedAt,
      autoCaptured: state.meta.autoCaptured,
      ops: state.ops.length,
      source: state.meta.source,
    },
    portfolio,
  });
});

app.get('/api/portfolio', async (req, res) => {
  const portfolio = await refreshPortfolio(req.query.force === '1');
  if (!portfolio) return res.status(503).json({ error: state.error || 'Sin datos todavía' });
  res.json(portfolio);
});

app.post('/api/sync', async (req, res) => {
  if (!client.configured) return res.status(400).json({ error: 'Configura primero las claves de Bitvavo' });
  const result = await syncFromBitvavo({ force: true });
  if (!result.ok && result.reason === 'busy') return res.status(409).json({ error: 'Ya hay una sincronización en curso' });
  await refreshPortfolio(true);
  res.json({ ...result, portfolio: state.portfolio });
});

app.get('/api/history', (req, res) => {
  const limit = Math.min(5000, Number(req.query.limit) || 2000);
  res.json({ points: state.snapshots.slice(-limit), intervalMin: SNAP_MIN });
});

app.get('/api/evolution', async (req, res) => {
  const ops = opsForView();
  if (!ops.length) return res.json({ ok: false, points: [] });
  try {
    if (state.mode === 'demo' && !state.ops.length) {
      const points = demoEvolution(state.prices);
      return res.json({ ok: true, points, demo: true, from: points.length ? points[0].t : null, to: points.length ? points[points.length - 1].t : null });
    }
    const symbols = [...new Set(ops.filter(o => o.currency && o.currency !== 'EUR').map(o => o.currency))];
    const today = new Date().toISOString().slice(0, 10);
    if (state.evolutionCache.data && state.evolutionCache.day === today) {
      return res.json(state.evolutionCache.data);
    }
    const prices = {};
    for (const s of symbols) {
      try {
        const candles = await client.candles(`${s}-EUR`, '1d', 1000);
        prices[s] = (Array.isArray(candles) ? candles : [])
          .map(c => ({ t: c[0], close: parseFloat(c[4]) }))
          .filter(p => isFinite(p.close))
          .sort((a, b) => a.t - b.t);
      } catch {
        prices[s] = [];
      }
      await new Promise(r => setTimeout(r, 60));
    }
    const points = evolutionSeries(ops, prices, { until: req.query.until });
    const payload = { ok: true, points, symbols, from: points.length ? points[0].t : null, to: points.length ? points[points.length - 1].t : null };
    state.evolutionCache = { at: Date.now(), day: today, data: payload };
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/candles', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC').toUpperCase();
  const interval = String(req.query.interval || '1d');
  const limit = Math.min(1000, Number(req.query.limit) || 180);
  try {
    const raw = await client.candles(`${symbol}-EUR`, interval, limit);
    const points = (Array.isArray(raw) ? raw : []).map(c => ({
      t: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
    }));
    res.json({ symbol, interval, points });
  } catch (e) {
    res.status(502).json({ error: 'No se pudieron obtener las velas: ' + e.message });
  }
});

app.get('/api/fear-greed', async (req, res) => {
  const data = await getFearGreed(DATA_DIR);
  res.json(data);
});

// ---------------- operaciones ----------------
const TYPE_LABEL = { buy: 'Compra', sell: 'Venta', deposit: 'Depósito', withdrawal: 'Retiro', rebate: 'Rebaja', reward: 'Recompensa' };

function transactions() {
  return opsForView()
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .map(op => {
      const price = op.quotePrice || 0;
      const amount = op.amount || 0;
      const isTrade = op.type === 'buy' || op.type === 'sell';
      return {
        id: op.id || '',
        ts: op.ts,
        type: op.type,
        label: TYPE_LABEL[op.type] || op.type,
        symbol: op.currency,
        amount,
        price: isTrade ? price : 0,
        value: isTrade ? round(op.paidEur || amount * price, 2) : 0,
        fee: op.fee || 0,
        feeCurrency: op.feeCurrency || '',
        status: op.status || '',
        address: op.address || null,
      };
    });
}

app.get('/api/transactions', (req, res) => {
  const rows = transactions();
  res.json({ total: rows.length, rows });
});

app.get('/api/transactions.csv', (req, res) => {
  const rows = transactions();
  const head = ['Fecha', 'Tipo', 'Moneda', 'Cantidad', 'Precio (EUR)', 'Importe (EUR)', 'Comisión', 'Moneda comisión', 'Estado', 'ID'];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([
      new Date(r.ts).toLocaleString('es-ES'),
      r.label, r.symbol,
      String(r.amount).replace('.', ','),
      r.price ? String(round(r.price, 8)).replace('.', ',') : '',
      r.value ? String(r.value).replace('.', ',') : '',
      r.fee ? String(r.fee).replace('.', ',') : '',
      r.feeCurrency, r.status, r.id,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="quanto-operaciones.csv"');
  res.send('\uFEFF' + lines.join('\r\n'));
});

// ---------------- fiscal ----------------
app.get('/api/tax', async (req, res) => {
  const ops = opsForView();
  if (!ops.length) {
    return res.json({ ok: false, message: 'Importa el historial completo de Bitvavo para calcular el informe fiscal.' });
  }
  try {
    const report = taxReport(ops);
    let prices = state.prices;
    if (!prices || !Object.keys(prices).length) {
      try { prices = (await fetchMarket()).prices; } catch {}
    }
    const inventory = Object.values(report.inventory).map(item => {
      const price = Number(prices[item.symbol]) || 0;
      return {
        ...item,
        price,
        hasPrice: price > 0,
        value: price > 0 ? round(item.amount * price, 2) : null,
        pnl: price > 0 ? round(item.amount * price - item.cost, 2) : null,
      };
    }).sort((a, b) => (b.value || 0) - (a.value || 0));
    const totals = {
      ...report.totals,
      inventoryValue: round(inventory.reduce((a, i) => a + (i.value || 0), 0), 2),
      inventoryCost: round(inventory.reduce((a, i) => a + i.cost, 0), 2),
    };
    res.json({ ...report, inventory, totals, year: req.query.year || 'all' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tax/simulate', async (req, res) => {
  const ops = opsForView();
  if (!ops.length) return res.json({ ok: false, message: 'Necesitas el historial importado.' });
  const symbol = String(req.query.symbol || '').toUpperCase();
  const amount = Number(req.query.amount) || 0;
  if (!symbol || amount <= 0) return res.status(400).json({ error: 'Indica moneda y cantidad' });
  try {
    const sim = simulateSale(ops, symbol, amount);
    let price = Number(req.query.price) || 0;
    if (!price) {
      price = Number(state.prices[symbol]) || 0;
      if (!price) {
        try { price = Number((await fetchMarket()).prices[symbol]) || 0; } catch {}
      }
    }
    const proceeds = round(amount * price, 2);
    const matched = sim.matchedAmount;
    const fifoGain = round(proceeds - sim.fifoCost, 2);
    const avgGain = round(proceeds - sim.avgCostUsed, 2);
    res.json({
      ok: true,
      symbol,
      amount,
      price,
      proceeds,
      available: sim.available,
      matched,
      unmatched: sim.unmatchedAmount,
      fifo: { cost: sim.fifoCost, gain: fifoGain, tax: estimateTax(fifoGain), lots: sim.fifoLots },
      average: { cost: sim.avgCostUsed, gain: avgGain, tax: estimateTax(avgGain), unitCost: sim.avgCost },
      netAfterTax: round(proceeds - estimateTax(fifoGain), 2),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- importaciones ----------------
app.post('/api/import/history', (req, res) => {
  const text = String((req.body && req.body.text) || '');
  if (text.trim().length < 20) return res.status(400).json({ error: 'Pega o sube el CSV del historial completo de Bitvavo.' });
  let ops = [];
  try { ops = parseBitvavoHistory(text); } catch (e) { console.log('[import]', e.message); }
  if (!ops.length) {
    return res.status(400).json({ error: 'No he reconocido el archivo. En Bitvavo: Historial → descargar CSV (el completo, no el de la cartera).' });
  }
  const merged = mergeOps([], ops);
  state.ops = merged.ops;
  state.meta = { importedAt: Date.now(), autoCaptured: 0, lastSyncAt: state.meta.lastSyncAt, source: 'csv' };
  refreshAnalysis();
  saveOps();
  state.evolutionCache = { at: 0, day: '', data: null };
  state.portfolioAt = 0;
  const stats = analyze(state.ops);
  console.log(`[import] ${state.ops.length} operaciones de ${Object.keys(stats.byCoin).length} monedas`);
  res.json({
    ok: true,
    ops: state.ops.length,
    coins: Object.keys(stats.byCoin).length,
    sells: stats.totals.sells,
    from: stats.range.from,
    to: stats.range.to,
    bought: stats.totals.boughtCost,
    sold: stats.totals.soldProceeds,
    unmatched: stats.realized.unmatchedProceeds,
  });
});

app.get('/api/import/status', (req, res) => {
  res.json({
    imported: !!state.meta.importedAt,
    importedAt: state.meta.importedAt,
    source: state.meta.source,
    ops: state.ops.length,
    autoCaptured: state.meta.autoCaptured,
    lastSyncAt: state.meta.lastSyncAt,
    coins: state.analysis ? Object.keys(state.analysis.byCoin).length : 0,
    from: state.analysis ? state.analysis.range.from : null,
    to: state.analysis ? state.analysis.range.to : null,
  });
});

// ---------------- alertas de precio (Telegram) ----------------
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const ALERT_CHECK_MS = 60e3;
let alertBusy = false;
let lastAlertRefresh = 0;

function getAlertStore() {
  const s = readJson(ALERTS_FILE, null);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { rules: [] };
  if (!Array.isArray(s.rules)) s.rules = [];
  return s;
}
function saveAlertStore(s) { writeJson(ALERTS_FILE, s); }

function telegramConfig() {
  const s = getSettings();
  const t = (s && s.telegram) || {};
  return { token: String(t.token || '').trim(), chatId: String(t.chatId || '').trim() };
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return null;
  if (s.includes(':')) {
    const [id, rest] = s.split(':');
    return `${id}:••••••${rest.slice(-4)}`;
  }
  return s.length <= 4 ? '••••' : s.slice(0, 2) + '••••' + s.slice(-2);
}

async function telegramSend(text) {
  const { token, chatId } = telegramConfig();
  if (!token || !chatId) throw new Error('Falta el bot y el chat de Telegram');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram respondió ${res.status}`);
  return data.result || {};
}

const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfNum = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 8 });
const nfPct = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const money = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : eur2.format(v));
const qty = (v) => (isFinite(v) ? nfNum.format(v) : '—');
const pctFmt = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${nfPct.format(v)} %`);
function moneySmart(v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  let d = 2;
  if (v < 0.01) d = 6; else if (v < 1) d = 4; else if (v < 100) d = 3;
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function alertMessage(rule, coin) {
  const ops = opsForView();
  const amount = Number(coin.amount) || 0;
  let fifoCost = null;
  let gain = null;
  try {
    if (ops.length && amount > 0) {
      const sim = simulateSale(ops, coin.symbol, amount);
      if (sim.matchedAmount > 0) {
        fifoCost = sim.fifoCost;
        gain = round(amount * (Number(coin.price) || 0) - sim.fifoCost, 2);
      }
    }
  } catch (e) { console.log('[alertas] fiscal:', e.message); }
  const tax = gain === null ? null : (gain > 0 ? estimateTax(gain) : 0);
  const dir = rule.op === 'above' ? 'por encima de' : 'por debajo de';
  const lines = [];
  lines.push(`🔔 <b>${escHtml(coin.symbol)}</b> ${dir} <b>${moneySmart(rule.price)}</b>`);
  lines.push(`Precio ahora: <b>${moneySmart(coin.price)}</b>${coin.dayChangePct === null || coin.dayChangePct === undefined ? '' : ` (${pctFmt(coin.dayChangePct)} hoy)`}`);
  lines.push('');
  lines.push(`Cantidad: ${qty(amount)} ${escHtml(coin.symbol)}`);
  lines.push(`Valor actual: ${money(coin.value)}`);
  lines.push(`Tu precio medio: ${coin.costKnown && coin.avgPrice ? moneySmart(coin.avgPrice) : 'n/d'}`);
  if (coin.costKnown) {
    lines.push(`P/L si vendes: <b>${coin.pnl >= 0 ? '+' : ''}${money(coin.pnl)}</b> (${pctFmt(coin.pnlPct)})`);
  }
  if (gain !== null) {
    lines.push(`Coste FIFO: ${money(fifoCost)}`);
    lines.push(`Ganancia FIFO: ${gain >= 0 ? '+' : ''}${money(gain)}`);
    lines.push(gain > 0
      ? `Impuestos estimados: <b>${money(tax)}</b>`
      : 'Impuestos: 0 € (pérdida compensable 4 ejercicios)');
  } else {
    lines.push('Fiscal: sin historial suficiente para calcular');
  }
  lines.push('');
  lines.push(`<i>Quanto · ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</i>`);
  return lines.join('\n');
}

async function runAlertCheck() {
  if (alertBusy) return { fired: [], reason: 'busy' };
  const store = getAlertStore();
  const rules = store.rules.filter(r => r.enabled !== false);
  if (!rules.length) return { fired: [], reason: 'sin-alertas' };
  const tg = telegramConfig();
  if (!tg.token || !tg.chatId) return { fired: [], reason: 'telegram-sin-configurar' };
  alertBusy = true;
  const fired = [];
  try {
    const force = Date.now() - lastAlertRefresh > 120e3;
    const portfolio = await refreshPortfolio(force);
    lastAlertRefresh = Date.now();
    if (!portfolio || !Array.isArray(portfolio.coins)) return { fired: [] };
    for (const rule of rules) {
      const coin = portfolio.coins.find(c => c.symbol === rule.symbol);
      const price = coin ? Number(coin.price) : NaN;
      if (!coin || !isFinite(price) || price <= 0) continue;
      const hit = rule.op === 'above' ? price >= rule.price : price <= rule.price;
      const armed = rule.armed !== false;
      const coolMs = Math.max(5, Number(rule.cooldownMin) || 60) * 60e3;
      const cooled = !rule.lastSentAt || Date.now() - rule.lastSentAt > coolMs;
      if (hit && armed && cooled) {
        try {
          await telegramSend(alertMessage(rule, coin));
          rule.lastSentAt = Date.now();
          rule.armed = false;
          delete rule.lastError;
          fired.push({ id: rule.id, symbol: rule.symbol, price });
          console.log(`[alertas] enviada ${rule.symbol} a ${price}`);
        } catch (e) {
          rule.lastError = e.message;
          console.error('[alertas] envío:', e.message);
        }
      } else if (!hit && rule.armed === false) {
        // re-armar con 1 % de histéresis para que no parpadee en el umbral
        const back = rule.op === 'above' ? price <= rule.price * 0.99 : price >= rule.price * 1.01;
        if (back) { rule.armed = true; delete rule.lastError; }
      }
      rule.lastPrice = price;
    }
    saveAlertStore(store);
    return { fired };
  } finally {
    alertBusy = false;
  }
}

app.get('/api/alerts', (req, res) => {
  const store = getAlertStore();
  const tg = telegramConfig();
  res.json({
    ok: true,
    rules: store.rules,
    telegram: {
      configured: !!(tg.token && tg.chatId),
      tokenMasked: maskSecret(tg.token),
      chatId: tg.chatId || null,
    },
    intervalMin: 1,
  });
});

app.get('/api/alerts/preview', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'XRP').toUpperCase();
    const portfolio = await refreshPortfolio(false);
    const coin = portfolio && Array.isArray(portfolio.coins) ? portfolio.coins.find(c => c.symbol === symbol) : null;
    if (!coin) return res.status(404).json({ error: 'Esa moneda no está en la cartera' });
    const price = Number(req.query.price) || Number(coin.price) * 0.98;
    const text = alertMessage({ symbol, price, op: req.query.op === 'above' ? 'above' : 'below' }, coin);
    res.json({ ok: true, symbol, price, text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/alerts', (req, res) => {
  const b = req.body || {};
  const symbol = String(b.symbol || '').toUpperCase().trim();
  const price = Number(b.price);
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  if (!(price > 0)) return res.status(400).json({ error: 'El precio debe ser mayor que 0' });
  const op = b.op === 'above' ? 'above' : 'below';
  const store = getAlertStore();
  let rule = b.id ? store.rules.find(r => r.id === b.id) : null;
  if (rule) {
    Object.assign(rule, { symbol, price, op, enabled: b.enabled !== false, armed: true, updatedAt: Date.now() });
    delete rule.lastError;
  } else {
    const dup = store.rules.find(r => r.symbol === symbol && r.op === op);
    if (dup) return res.status(400).json({ error: `Ya tienes una alerta para ${symbol} (${op === 'above' ? 'por encima' : 'por debajo'})` });
    if (store.rules.length >= 50) return res.status(400).json({ error: 'Máximo 50 alertas' });
    rule = {
      id: crypto.randomBytes(4).toString('hex'),
      symbol, price, op,
      enabled: true, armed: true,
      createdAt: Date.now(), lastSentAt: null,
    };
    store.rules.push(rule);
  }
  saveAlertStore(store);
  res.json({ ok: true, rule });
});

app.delete('/api/alerts/:id', (req, res) => {
  const store = getAlertStore();
  const before = store.rules.length;
  store.rules = store.rules.filter(r => r.id !== req.params.id);
  if (store.rules.length === before) return res.status(404).json({ error: 'No existe' });
  saveAlertStore(store);
  res.json({ ok: true });
});

app.post('/api/alerts/:id/toggle', (req, res) => {
  const store = getAlertStore();
  const rule = store.rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: 'No existe' });
  rule.enabled = rule.enabled === false;
  if (rule.enabled) { rule.armed = true; delete rule.lastError; }
  saveAlertStore(store);
  res.json({ ok: true, rule });
});

app.post('/api/alerts/check', async (req, res) => {
  try {
    const out = await runAlertCheck();
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/telegram', (req, res) => {
  const b = req.body || {};
  const s = getSettings();
  const token = String(b.token !== undefined ? b.token : (s.telegram && s.telegram.token) || '').trim();
  const chatId = String(b.chatId !== undefined ? b.chatId : (s.telegram && s.telegram.chatId) || '').trim();
  s.telegram = { token, chatId };
  saveSettings(s);
  res.json({ ok: true, configured: !!(token && chatId), tokenMasked: maskSecret(token), chatId });
});

app.post('/api/telegram/test', async (req, res) => {
  try {
    await telegramSend('✅ <b>Quanto</b> conectado: los avisos de precio llegarán a este chat.');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------- ajustes ----------------
app.get('/api/settings', (req, res) => {
  const s = getSettings();
  res.json({
    theme: s.theme || 'dark',
    hasPassword: !!(s.password && s.password.hash) || !!(process.env.APP_PASSWORD || '').trim(),
    apiKeyMasked: s.apiKey ? s.apiKey.slice(0, 4) + '••••••' + s.apiKey.slice(-4) : null,
    apiKeySet: !!s.apiKey,
    keysCleared: !!s.keysCleared,
    mode: effectiveMode(),
    version: VERSION,
    dataDir: DATA_DIR,
  });
});

app.post('/api/settings', (req, res) => {
  const body = req.body || {};
  const s = getSettings();

  if (body.password !== undefined) {
    const next = String(body.password || '');
    if (next.length < 8 || next.length > 128) {
      return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres' });
    }
    if (!checkPassword(String(body.currentPassword || ''))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }
    s.password = Object.assign({ algo: 'scrypt', changedAt: Date.now() }, hashPassword(next));
  }

  if (body.apiKey !== undefined || body.apiSecret !== undefined) {
    const key = body.apiKey === undefined ? s.apiKey : String(body.apiKey || '').trim();
    const secret = body.apiSecret === undefined ? s.apiSecret : String(body.apiSecret || '').trim();
    if (key && secret) {
      const test = new BitvavoClient({ key, secret });
      // validación síncrona diferida: se comprueba al guardar con una petición
      s.apiKey = key;
      s.apiSecret = secret;
      delete s.keysCleared;
      client.setKeys(key, secret);
      state.mode = 'live';
      test.account().then(() => {
        state.keysError = null;
      }).catch(e => {
        state.keysError = e.status === 401 || e.status === 403 ? 'Bitvavo ha rechazado las claves (revisa permisos de solo lectura)' : e.message;
      });
    } else if (body.clearKeys) {
      delete s.apiKey;
      delete s.apiSecret;
      s.keysCleared = true;
      client.setKeys('', '');
      state.mode = 'demo';
    }
  }

  if (body.theme === 'dark' || body.theme === 'light') s.theme = body.theme;
  saveSettings(s);
  applyKeys();
  state.portfolioAt = 0;
  res.json({ ok: true, theme: s.theme || 'dark', mode: effectiveMode(), keysError: state.keysError });
});

app.get('/api/holdings', (req, res) => res.json(readJson(FILES.holdings, {}) || {}));

app.post('/api/holdings', (req, res) => {
  const symbol = String((req.body && req.body.symbol) || '').trim().toUpperCase();
  const amount = Number((req.body || {}).amount);
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  if (!isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Cantidad no válida' });
  const rawInvested = (req.body || {}).invested;
  let invested = null;
  if (rawInvested !== '' && rawInvested !== null && rawInvested !== undefined) {
    invested = Number(rawInvested);
    if (!isFinite(invested) || invested < 0) return res.status(400).json({ error: 'Inversión no válida' });
  }
  const holdings = readJson(FILES.holdings, {}) || {};
  if (amount === 0) delete holdings[symbol];
  else holdings[symbol] = { amount, invested };
  writeJson(FILES.holdings, holdings);
  state.portfolioAt = 0;
  res.json(holdings);
});

app.delete('/api/holdings/:symbol', (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  const holdings = readJson(FILES.holdings, {}) || {};
  delete holdings[symbol];
  writeJson(FILES.holdings, holdings);
  state.portfolioAt = 0;
  res.json(holdings);
});

app.get('/api/overrides', (req, res) => res.json(readJson(FILES.overrides, {}) || {}));
app.post('/api/overrides', (req, res) => {
  const symbol = String((req.body || {}).symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  const raw = (req.body || {}).invested;
  const overrides = readJson(FILES.overrides, {}) || {};
  if (raw === '' || raw === null || raw === undefined) delete overrides[symbol];
  else {
    const v = Number(raw);
    if (!isFinite(v) || v < 0) return res.status(400).json({ error: 'Inversión no válida' });
    overrides[symbol] = v;
  }
  writeJson(FILES.overrides, overrides);
  state.portfolioAt = 0;
  res.json(overrides);
});

// ---------------- copias y mantenimiento ----------------
const BACKUP_FILES = { ops: FILES.ops, history: FILES.history, holdings: FILES.holdings, overrides: FILES.overrides };

app.get('/api/backup', (req, res) => {
  const out = { app: 'quanto', version: VERSION, exportedAt: new Date().toISOString(), files: {} };
  for (const [key, file] of Object.entries(BACKUP_FILES)) {
    out.files[key] = readJson(file, null);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quanto-copia-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(out, null, 1));
});

app.post('/api/restore', (req, res) => {
  const backup = (req.body || {}).backup;
  const files = backup && backup.files;
  if (!files || typeof files !== 'object') return res.status(400).json({ error: 'Ese archivo no es una copia de Quanto.' });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const restored = [];
  for (const [key, file] of Object.entries(BACKUP_FILES)) {
    if (files[key] === undefined || files[key] === null) continue;
    try { if (exists(file)) fs.copyFileSync(file, file + '.bak-' + stamp); } catch {}
    writeJson(file, files[key]);
    restored.push(path.basename(file));
  }
  if (!restored.length) return res.status(400).json({ error: 'La copia no contiene datos que restaurar.' });
  loadOps();
  state.portfolioAt = 0;
  state.evolutionCache = { at: 0, day: '', data: null };
  res.json({ ok: true, restored });
});

app.post('/api/wipe', (req, res) => {
  if (String((req.body || {}).confirm || '') !== 'BORRAR') {
    return res.status(400).json({ error: 'Escribe BORRAR para confirmar' });
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  for (const file of Object.values(BACKUP_FILES)) {
    try {
      if (exists(file)) {
        fs.copyFileSync(file, file + '.bak-' + stamp);
        fs.unlinkSync(file);
      }
    } catch (e) { console.log('[wipe]', e.message); }
  }
  state.ops = [];
  state.meta = { importedAt: null, autoCaptured: 0, lastSyncAt: null, source: null };
  state.analysis = null;
  state.portfolio = null;
  state.portfolioAt = 0;
  state.snapshots = [];
  state.evolutionCache = { at: 0, day: '', data: null };
  writeJson(FILES.history, []);
  res.json({ ok: true, backupSuffix: stamp });
});

// ---------------- Excel ----------------
function styleSheet(ws, columns) {
  ws.columns = columns;
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101826' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

const MONEY = '#,##0.00';
const QTY = '#,##0.00000000';

app.get('/api/export/transactions.xlsx', async (req, res) => {
  try {
    const rows = transactions();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Quanto';
    const ws = wb.addWorksheet('Operaciones');
    styleSheet(ws, [
      { header: 'Fecha', key: 'date', width: 18 },
      { header: 'Tipo', key: 'type', width: 12 },
      { header: 'Moneda', key: 'symbol', width: 10 },
      { header: 'Cantidad', key: 'amount', width: 18 },
      { header: 'Precio (EUR)', key: 'price', width: 16 },
      { header: 'Importe (EUR)', key: 'value', width: 16 },
      { header: 'Comisión', key: 'fee', width: 12 },
      { header: 'Moneda comisión', key: 'feeCurrency', width: 16 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'ID', key: 'id', width: 28 },
    ]);
    for (const r of rows) {
      const row = ws.addRow({
        date: new Date(r.ts), type: r.label, symbol: r.symbol, amount: r.amount,
        price: r.price || null, value: r.value || null, fee: r.fee || null,
        feeCurrency: r.feeCurrency, status: r.status, id: r.id,
      });
      row.getCell('date').numFmt = 'dd/mm/yyyy hh:mm';
      row.getCell('amount').numFmt = QTY;
      row.getCell('price').numFmt = MONEY;
      row.getCell('value').numFmt = MONEY;
      row.getCell('fee').numFmt = QTY;
    }
    const summary = wb.addWorksheet('Resumen');
    styleSheet(summary, [{ header: 'Concepto', key: 'k', width: 34 }, { header: 'Valor', key: 'v', width: 18 }]);
    const t = analyze(opsForView()).totals;
    for (const [k, v] of [
      ['Operaciones totales', rows.length], ['Compras', t.buys], ['Ventas', t.sells],
      ['Depósitos', t.deposits], ['Retiros', t.withdrawals],
      ['Total comprado (EUR)', t.boughtCost], ['Total vendido (EUR)', t.soldProceeds],
      ['Comisiones (EUR)', t.feesEur], ['Depósitos en EUR', t.depositsEur],
    ]) {
      const row = summary.addRow({ k, v });
      if (typeof v === 'number' && k.includes('EUR')) row.getCell('v').numFmt = MONEY;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="quanto-operaciones.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[xlsx]', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/export/tax.xlsx', async (req, res) => {
  try {
    if (!opsForView().length) return res.status(400).json({ error: 'No hay historial importado' });
    const report = taxReport(opsForView());
    const year = req.query.year && req.query.year !== 'all' ? Number(req.query.year) : null;
    const years = year ? report.years.filter(y => y.year === year) : report.years;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Quanto';

    const tx = wb.addWorksheet('Transmisiones');
    styleSheet(tx, [
      { header: 'Ejercicio', key: 'year', width: 10 },
      { header: 'Fecha de adquisición', key: 'buyDate', width: 20 },
      { header: 'Fecha de transmisión', key: 'sellDate', width: 20 },
      { header: 'Moneda', key: 'symbol', width: 10 },
      { header: 'Cantidad', key: 'amount', width: 18 },
      { header: 'Valor de adquisición (EUR)', key: 'cost', width: 24 },
      { header: 'Valor de transmisión (EUR)', key: 'proceeds', width: 26 },
      { header: 'Ganancia/Pérdida (EUR)', key: 'gain', width: 24 },
      { header: '¿Sin coste conocido?', key: 'warn', width: 20 },
    ]);
    for (const y of years) {
      for (const d of y.disposals) {
        for (const lot of d.lots) {
          const share = d.amount > 0 ? lot.amount / d.amount : 0;
          const row = tx.addRow({
            year: y.year,
            buyDate: new Date(lot.ts),
            sellDate: new Date(d.ts),
            symbol: d.symbol,
            amount: lot.amount,
            cost: round(lot.amount * lot.unitCost, 2),
            proceeds: round(d.proceeds * share, 2),
            gain: round(d.proceeds * share - lot.amount * lot.unitCost, 2),
            warn: '',
          });
          row.getCell('buyDate').numFmt = 'dd/mm/yyyy';
          row.getCell('sellDate').numFmt = 'dd/mm/yyyy';
          row.getCell('amount').numFmt = QTY;
          row.getCell('cost').numFmt = MONEY;
          row.getCell('proceeds').numFmt = MONEY;
          row.getCell('gain').numFmt = MONEY;
        }
        if (d.unmatchedAmount > 0) {
          const row = tx.addRow({
            year: y.year, buyDate: '', sellDate: new Date(d.ts), symbol: d.symbol,
            amount: d.unmatchedAmount, cost: null, proceeds: round(d.unmatchedProceeds, 2),
            gain: null, warn: 'SÍ — sin compra registrada',
          });
          row.getCell('amount').numFmt = QTY;
          row.getCell('proceeds').numFmt = MONEY;
          row.getCell('warn').font = { color: { argb: 'FFCC3300' }, bold: true };
        }
      }
    }

    const rs = wb.addWorksheet('Resumen por ejercicio');
    styleSheet(rs, [
      { header: 'Ejercicio', key: 'year', width: 10 },
      { header: 'Nº transmisiones', key: 'count', width: 18 },
      { header: 'Valor de transmisión (EUR)', key: 'proceeds', width: 26 },
      { header: 'Valor de adquisición (EUR)', key: 'cost', width: 24 },
      { header: 'Ganancia/Pérdida (EUR)', key: 'gain', width: 24 },
      { header: 'Cuota estimada (EUR)', key: 'tax', width: 22 },
      { header: 'Sin coste conocido (EUR)', key: 'unmatched', width: 26 },
    ]);
    for (const y of years) {
      const row = rs.addRow({
        year: y.year, count: y.count, proceeds: y.proceeds, cost: y.cost,
        gain: y.gain, tax: y.tax, unmatched: y.unmatchedProceeds || null,
      });
      for (const c of ['proceeds', 'cost', 'gain', 'tax', 'unmatched']) row.getCell(c).numFmt = MONEY;
    }

    const inv = wb.addWorksheet('Inventario FIFO');
    styleSheet(inv, [
      { header: 'Moneda', key: 'symbol', width: 10 },
      { header: 'Cantidad', key: 'amount', width: 18 },
      { header: 'Coste FIFO (EUR)', key: 'cost', width: 18 },
      { header: 'Coste medio (EUR)', key: 'avg', width: 18 },
      { header: 'Compra más antigua', key: 'oldest', width: 20 },
    ]);
    for (const item of Object.values(report.inventory).sort((a, b) => b.cost - a.cost)) {
      const row = inv.addRow({
        symbol: item.symbol, amount: item.amount, cost: item.cost,
        avg: round(item.avgCost, 6), oldest: item.oldest ? new Date(item.oldest) : '',
      });
      row.getCell('amount').numFmt = QTY;
      row.getCell('cost').numFmt = MONEY;
      row.getCell('avg').numFmt = MONEY;
      if (item.oldest) row.getCell('oldest').numFmt = 'dd/mm/yyyy';
    }

    const guide = wb.addWorksheet('Cómo declararlo');
    guide.columns = [{ width: 110 }];
    guide.getCell('A1').value = 'CÓMO DECLARARLO EN LA RENTA (Modelo 100)';
    guide.getCell('A1').font = { bold: true, size: 14 };
    const lines = [
      '',
      '1. Apartado: Ganancias y pérdidas patrimoniales → «Transmisiones de monedas virtuales» (base del ahorro).',
      '2. Declara una línea por cada lote de la hoja «Transmisiones»: fecha de adquisición, fecha de transmisión,',
      '   valor de adquisición (lo que pagaste) y valor de transmisión (lo que recibiste).',
      '3. La ganancia o pérdida la calcula el programa. Comprueba que cuadra con la columna «Ganancia/Pérdida».',
      '4. Si el resultado del año es negativo, compensa con ganancias patrimoniales del mismo año y, lo que sobre,',
      '   con los 4 ejercicios siguientes.',
      '5. Mover monedas entre Bitvavo y tu wallet NO tributa: solo tributan las ventas.',
      '6. Guarda «Resumen por ejercicio» e «Inventario FIFO»: son la base del ejercicio siguiente.',
      '',
      'AVISOS',
      '- Este informe usa FIFO (se venden primero las compras más antiguas). En España no hay un método obligatorio,',
      '  pero debes aplicar el mismo criterio de forma constante. Si usas coste medio, sé coherente todos los años.',
      '- Tramos de la base del ahorro: 19 % / 21 % / 23 % / 27 % / 30 %.',
      '- La cuota es una ESTIMACIÓN sobre tus datos de Bitvavo. Si tienes otras rentas del ahorro, tu tipo real puede ser mayor.',
      '- Las filas marcadas «sin coste conocido» necesitan que completes la compra que falta antes de declarar.',
      '- La app no presenta la declaración: te deja los datos listos para el formulario o para tu asesor.',
    ];
    lines.forEach((line, i) => {
      const cell = guide.getCell('A' + (i + 3));
      cell.value = line;
      cell.alignment = { wrapText: true, vertical: 'top' };
      if (/^[A-ZÁÉÍÓÚÑ ]{4,}$/.test(line.trim())) cell.font = { bold: true };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="quanto-informe-fiscal-${year || 'todos'}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[xlsx fiscal]', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------- estáticos ----------------
app.use((req, res, next) => {
  if (/\.(js|css|html|webmanifest)$/.test(req.path)) res.setHeader('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// Compatibilidad con la ruta de la app anterior (/app.html) y con enlaces antiguos
app.get(['/app.html', '/app'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No existe' });
  res.status(404).send('No encontrado');
});

// ---------------- arranque ----------------
loadOps();
applyKeys();

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Quanto ${VERSION} en http://0.0.0.0:${PORT} · modo ${state.mode}`);
  console.log(`Datos en ${DATA_DIR}`);
  try {
    if (state.mode === 'live') {
      const sync = await syncFromBitvavo({ force: true });
      if (!sync.ok) console.log('[sync] inicial:', sync.error || sync.reason);
    }
    await refreshPortfolio(true);
    if (state.portfolio) {
      console.log(`Cartera: ${state.portfolio.totalValue} EUR · ${state.portfolio.coinCount} monedas`);
    }
  } catch (e) {
    console.error('[arranque]', e.message);
  }
});

setInterval(() => { refreshPortfolio(true).catch(() => {}); }, SNAP_MS);

let syncTimer = 0;
setInterval(() => {
  if (!client.configured) return;
  if (Date.now() - syncTimer < 2 * 60e3) return;
  syncTimer = Date.now();
  syncFromBitvavo().catch(() => {});
}, 2 * 60e3);

// Alertas de precio: se revisan cada minuto (Telegram).
setInterval(() => { runAlertCheck().catch(() => {}); }, ALERT_CHECK_MS);

process.on('unhandledRejection', (err) => console.error('[unhandled]', err && err.message ? err.message : err));
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
