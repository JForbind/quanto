'use strict';
// Quanto — servidor Express.
// Modo live (claves de Bitvavo de solo lectura) o demo (datos de ejemplo).
const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
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
const { computeTwr } = require('./lib/twr');
const backupUtil = require('./lib/backup');
const coherence = require('./lib/coherence');
const { getFearGreed } = require('./lib/feargreed');
const { hashPassword, verifyPassword, safeEqual, createToken, verifyToken, createSessionToken, verifySessionToken, createLimiter } = require('./lib/auth');
const { createUserStore, passwordProblems, randomPassword } = require('./lib/users');
const { createTenant } = require('./lib/tenant');
const { createMailer } = require('./lib/mailer');
const { getLiquidity } = require('./lib/liquidity');
const { getNews } = require('./lib/news');
const { getLeverage } = require('./lib/leverage');
const { getPulse } = require('./lib/pulse');
const { getCalendar } = require('./lib/calendar');
const { analyze: analyzeMarket } = require('./lib/analyst');
const ranges = require('./lib/ranges');
const { detectRegime } = require('./lib/regime');
const regimeWatch = require('./lib/regime-watch');
const { sizePortfolio } = require('./lib/sizing');
const { realityCheck, STRATEGIES } = require('./lib/reality');
const totp = require('./lib/totp');
let QRCode = null;
try { QRCode = require('qrcode'); } catch (e) { console.log('[2fa] sin generador de QR:', e.message); }
const { round } = require('./lib/util');

const VERSION = '4.8.0';
const PORT = Number(process.env.PORT) || 8765;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SNAP_MIN = Math.max(1, Number(process.env.SNAP_INTERVAL_MIN) || 5);
const SNAP_MS = SNAP_MIN * 60e3;
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS) || 30);
const COOKIE_NAME = 'quanto_session';

ensureDir(DATA_DIR);

const userStore = createUserStore(DATA_DIR);
const mailer = createMailer(DATA_DIR);

// Rutas antiguas (antes de multi-usuario): solo para la migración inicial.
const LEGACY_FILES = {
  ops: path.join(DATA_DIR, 'bitvavo-history.json'),
  history: path.join(DATA_DIR, 'history.json'),
  holdings: path.join(DATA_DIR, 'holdings.json'),
  overrides: path.join(DATA_DIR, 'overrides.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  alerts: path.join(DATA_DIR, 'alerts.json'),
  plans: path.join(DATA_DIR, 'plans.json'),
};

const tenant = createTenant({
  dataDir: DATA_DIR,
  userStore,
  loadOps: () => loadOps(),
  applyKeys: () => applyKeys(),
});
const FILES = tenant.FILES;

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

function currentUser() {
  const { userId } = tenant.ctx();
  return userId ? userStore.findById(userId) : null;
}

function checkPassword(password) {
  const user = currentUser();
  return user ? userStore.checkPassword(user.id, password) : false;
}

// ------------------------------------------------------------------ estado
const client = tenant.client;
const state = tenant.state;

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
function demoEnabled() {
  return String(process.env.DEMO || '') === '1';
}

function opsForView() {
  if (state.ops.length) return state.ops;
  // Los datos de ejemplo solo con DEMO=1: una cuenta nueva empieza vacía.
  if (demoEnabled() && state.mode === 'demo') return demoOps(state.prices);
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
function emptyPortfolio(prices) {
  return {
    mode: 'empty',
    updatedAt: new Date().toISOString(),
    currency: 'EUR',
    totalValue: 0,
    cryptoValue: 0,
    cash: 0,
    invested: 0,
    pnl: 0,
    pnlPct: 0,
    dayChangeValue: 0,
    dayChangePct: 0,
    coinCount: 0,
    coins: [],
    prices: prices || {},
  };
}

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
      portfolio = demoEnabled() ? demoPortfolio(state.prices, market.dayChange) : emptyPortfolio(state.prices);
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
// Lectura de la cookie de sesión (antes que cualquier guardia)
app.use((req, res, next) => {
  const raw = req.headers.cookie || '';
  const match = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  req.session = match ? decodeURIComponent(match[1]) : null;
  next();
});

// ---------------- control de acceso global ----------------
// Todo /api exige sesión salvo la lista pública. Se registra ANTES de las rutas
// para que ninguna pueda quedarse sin proteger.
const PUBLIC_API = new Set(['/api/health', '/api/status', '/api/setup', '/api/login', '/api/login/2fa', '/api/forgot', '/api/ca.crt', '/api/session']);
const ADMIN_OK = new Set(['/api/me', '/api/password', '/api/logout', '/api/status']);

function isPublicApi(full) {
  if (PUBLIC_API.has(full)) return true;
  return full.startsWith('/api/invite/');
}

app.use('/api', (req, res, next) => {
  const full = (req.originalUrl || '').split('?')[0];
  if (isPublicApi(full)) return next();
  requireAuth(req, res, () => {
    const user = req.user || {};
    if (user.role === 'admin' && !user.canData) {
      const allowed = ADMIN_OK.has(full) || full.startsWith('/api/users') || full.startsWith('/api/mail');
      if (!allowed) {
        return res.status(403).json({ error: 'La cuenta admin solo gestiona usuarios', code: 'admin-only' });
      }
    }
    next();
  });
});




const limiter = createLimiter({ windowMs: 10 * 60e3, max: 8 });
const forgotLimiter = createLimiter({ windowMs: 3600e3, max: 3 });
const heavyLimiter = createLimiter({ windowMs: 60e3, max: 240 });
const userLimiter = createLimiter({ windowMs: 15 * 60e3, max: 10 });
function limitHeavy(req, res, next) {
  const lim = heavyLimiter.check(clientIp(req) + ':' + req.path);
  if (!lim.allowed) return res.status(429).json({ error: 'Demasiadas peticiones, espera un momento' });
  next();
}
const loginAttempts = new Map();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function setSessionCookie(req, res, token) {
  const secure = (req.secure || req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function sessionPayload(req) {
  return verifySessionToken(COOKIE_SECRET, req.session);
}

const seenTouch = new Map();
function touchSeen(user) {
  const last = seenTouch.get(user.id) || 0;
  if (Date.now() - last < 5 * 60e3) return;
  seenTouch.set(user.id, Date.now());
  try { userStore.update(user.id, { lastSeenAt: Date.now() }); } catch {}
}

function requireAuth(req, res, next) {
  const payload = sessionPayload(req);
  if (!payload || !payload.u) return res.status(401).json({ error: 'No autorizado', code: 'unauthorized' });
  const user = userStore.findById(payload.u);
  if (!user || user.active === false) return res.status(401).json({ error: 'Cuenta no disponible', code: 'unauthorized' });
  if ((user.sessionVersion || 1) !== (payload.v || 1)) {
    return res.status(401).json({ error: 'Sesión caducada, vuelve a entrar', code: 'session' });
  }
  req.user = user;
  touchSeen(user);
  tenant.run(user, () => next());
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador', code: 'forbidden' });
  next();
}


// ---------------- público ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }));

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    mode: effectiveMode(),
    hasPassword: userStore.list().some(u => !!u.hash),
    imported: false,
  });
});

// Mini-gráfico de los últimos días (velas diarias de Bitvavo)
app.get('/api/sparklines', async (req, res) => {
  try {
    const p = state.portfolio || (await refreshPortfolio(false));
    const coins = (p && Array.isArray(p.coins)) ? p.coins : [];
    const sparklines = {};
    await Promise.all(coins.map(async (c) => {
      try {
        const candles = await client.candles(`${c.symbol}-EUR`, '1d', 30);
        if (!Array.isArray(candles) || candles.length < 3) return;
        // Bitvavo devuelve las velas de la más reciente a la más antigua:
        // las pasamos a orden cronológico antes de calcular nada.
        const closes = candles
          .map(k => Number(k && k[4]))
          .filter(n => isFinite(n) && n > 0)
          .reverse();
        if (closes.length < 3) return;
        sparklines[c.symbol] = closes.slice(-8);
      } catch { /* sin par en EUR o sin velas */ }
    }));
    // monedas extra (lista de vigilancia): no estan en cartera pero queremos su mini-grafico
    const extra = String(req.query.extra || '')
      .toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
    const yaEstan = new Set(coins.map(c => c.symbol));
    const faltan = extra.filter(s => !yaEstan.has(s) && !sparklines[s]);
    await Promise.all(faltan.map(async (sym) => {
      try {
        const candles = await client.candles(`${sym}-EUR`, '1d', 30);
        if (!Array.isArray(candles) || candles.length < 3) return;
        const closes = candles.map(k => Number(k && k[4])).filter(n => isFinite(n) && n > 0).reverse();
        if (closes.length >= 3) sparklines[sym] = closes.slice(-8);
      } catch {}
    }));

    res.json({ ok: true, sparklines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Radar del mercado: mayores subidas y bajadas de las últimas 24 h (Bitvavo, pares EUR)
app.get('/api/radar', async (req, res) => {
  try {
    const tickers = await client.ticker24h();
    const list = Array.isArray(tickers) ? tickers : [];
    const stable = new Set(['USDT', 'USDC', 'DAI', 'EURC', 'EURT', 'PYUSD', 'FDUSD', 'TUSD', 'USDP', 'EURS', 'USDD']);
    const rows = list
      .filter(t => t && typeof t.market === 'string' && t.market.endsWith('-EUR'))
      .map(t => {
        const symbol = t.market.slice(0, -4);
        const open = Number(t.open);
        const last = Number(t.last);
        if (!isFinite(open) || !isFinite(last) || open <= 0) return null;
        const change = ((last - open) / open) * 100;
        if (!isFinite(change)) return null;
        return { symbol, price: last, change };
      })
      .filter(r => r && !stable.has(r.symbol) && Math.abs(r.change) <= 150);
    const up = [...rows].sort((a, b) => b.change - a.change).slice(0, 5);
    const down = [...rows].sort((a, b) => a.change - b.change).slice(0, 5);
    res.json({ ok: true, up, down });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Velas para el panel de trading
const candleCache = new Map();

app.get('/api/candles', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  const interval = String(req.query.interval || '1h');
  const allowed = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
  if (!allowed.includes(interval)) return res.status(400).json({ error: 'Intervalo no válido' });
  const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 300));
  const clave = `${symbol}:${interval}:${limit}`;
  const previa = candleCache.get(clave);
  try {
    const raw = await client.candles(`${symbol}-EUR`, interval, limit);
    const candles = (Array.isArray(raw) ? raw : [])
      .map(k => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])])
      .filter(r => r.every(n => isFinite(n)))
      .reverse();
    if (candles.length) {
      candleCache.set(clave, { at: Date.now(), candles });
      if (candleCache.size > 300) {
        for (const [k, v] of candleCache) if (Date.now() - v.at > 10 * 60e3) candleCache.delete(k);
      }
    }
    res.json({ ok: true, symbol, interval, candles });
  } catch (e) {
    // si Bitvavo no responde, servimos la última copia buena (marcada como tal)
    if (previa && previa.candles.length) {
      return res.json({ ok: true, symbol, interval, candles: previa.candles, stale: true, ageMs: Date.now() - previa.at });
    }
    res.status(503).json({ error: 'Bitvavo no responde ahora mismo. Reintenta en unos segundos.' });
  }
});

// Crea (o reutiliza) el aviso de Telegram de un tramo del plan.
function ensurePlanAlert(plan, tranche) {
  const store = getAlertStore();
  const existing = store.rules.find(r => r.planId === plan.id && r.trancheId === tranche.id);
  if (existing) return existing;
  const dup = store.rules.find(r => r.symbol === plan.symbol && r.op === 'below' && Math.abs(Number(r.price) - tranche.price) < 1e-9 && !r.planId);
  if (dup) {
    dup.planId = plan.id;
    dup.trancheId = tranche.id;
    saveAlertStore(store);
    return dup;
  }
  if (store.rules.length >= 200) return null;
  const rule = {
    id: crypto.randomBytes(4).toString('hex'),
    symbol: plan.symbol,
    price: tranche.price,
    op: 'below',
    enabled: true,
    armed: true,
    createdAt: Date.now(),
    lastSentAt: null,
    planId: plan.id,
    trancheId: tranche.id,
  };
  store.rules.push(rule);
  saveAlertStore(store);
  return rule;
}

function removePlanAlert(planId, trancheId) {
  const store = getAlertStore();
  const before = store.rules.length;
  store.rules = store.rules.filter(r => !(r.planId === planId && r.trancheId === trancheId));
  if (store.rules.length !== before) saveAlertStore(store);
}

function removePlanAlerts(planId) {
  const store = getAlertStore();
  const before = store.rules.length;
  store.rules = store.rules.filter(r => r.planId !== planId);
  if (store.rules.length !== before) saveAlertStore(store);
}

// ---------------- planes de inversión ----------------
const plansFile = () => path.join(tenant.ctx().files.dir, 'plans.json');

function getPlanStore() {
  const s = readJson(plansFile(), null);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { plans: [] };
  if (!Array.isArray(s.plans)) s.plans = [];
  return s;
}
function savePlanStore(s) { writeJson(plansFile(), s); }
function planId() { return Math.random().toString(36).slice(2, 10); }

// Marca automáticamente los tramos cuando aparece una compra de esa moneda
// cuyo precio encaja con el del tramo (margen del 3 %) y aún no se había usado.
function autoMatchPlanBuys(store) {
  const ops = opsForView();
  if (!ops.length) return store;
  const TOL = 0.03;
  const opPrice = (o) => {
    const p1 = Number(o.quotePrice);
    if (p1 > 0) return p1;
    const p2 = Number(o.price);
    if (p2 > 0) return p2;
    const value = Number(o.paidEur) || Number(o.value) || 0;
    const amount = Number(o.amount) || 0;
    return value > 0 && amount > 0 ? value / amount : 0;
  };
  let changed = false;
  for (const plan of store.plans) {
    plan.usedOps = Array.isArray(plan.usedOps) ? plan.usedOps : [];
    const since = (plan.createdAt || 0) - 30 * 60e3;
    const buys = ops
      .filter(o => o.type === 'buy'
        && String(o.currency || o.symbol || '').toUpperCase() === plan.symbol
        && (o.ts || 0) > since
        && !plan.usedOps.includes(o.id))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (!buys.length) continue;
    // 1) consumir las compras que ya justifican tramos ejecutados a mano
    for (const tr of plan.tranches.filter(x => x.status === 'done' && !x.opId)) {
      const op = buys.find(o => {
        const p = opPrice(o);
        return p > 0 && Math.abs(p - tr.price) / tr.price <= TOL;
      });
      if (!op) continue;
      tr.opId = op.id;
      if (!tr.donePrice) tr.donePrice = opPrice(op);
      plan.usedOps.push(op.id);
      changed = true;
    }
    // 2) marcar tramos pendientes con las compras restantes
    const pending = plan.tranches.filter(x => x.status === 'pending').sort((a, b) => a.price - b.price);
    for (const tr of pending) {
      const op = buys.find(o => {
        if (plan.usedOps.includes(o.id)) return false;
        const p = opPrice(o);
        return p > 0 && Math.abs(p - tr.price) / tr.price <= TOL;
      });
      if (!op) continue;
      tr.status = 'done';
      tr.doneAt = op.ts;
      tr.donePrice = opPrice(op);
      tr.opId = op.id;
      plan.usedOps.push(op.id);
      removePlanAlert(plan.id, tr.id);
      changed = true;
      console.log(`[planes] ${plan.symbol}: tramo ${tr.price} marcado por compra a ${tr.donePrice}`);
    }
  }
  if (changed) savePlanStore(store);
  return store;
}


// ---------------- planes a partir de las órdenes de Bitvavo ----------------
async function openBitvavoBuys(symbol) {
  const raw = await client.request('GET', `/orders?market=${symbol}-EUR`, { auth: true });
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter(o => String(o.side) === 'buy' && String(o.status) === 'new')
    .map(o => ({
      orderId: String(o.orderId),
      price: Number(o.price) || 0,
      qty: Number(o.amount) || 0,
      remaining: Number(o.amountRemaining) || 0,
      created: Number(o.created) || Date.now(),
      type: String(o.orderType || 'limit'),
    }))
    .filter(o => o.price > 0 && (o.remaining || o.qty) > 0);
}

async function syncBitvavoPlans() {
  {
    const store = getPlanStore();
    autoMatchPlanBuys(store);
    const coins = ((state.portfolio && state.portfolio.coins) || []).map(c => c.symbol);
    const symbols = coins.length ? coins : [...new Set(store.plans.map(p => p.symbol))];
    let creados = 0, nuevos = 0, cerrados = 0, errores = 0;

    for (const symbol of symbols) {
      let orders = [];
      try { orders = await openBitvavoBuys(symbol); } catch (e) { errores++; continue; }

      let plan = store.plans.find(p => p.symbol === symbol && p.source === 'bitvavo');
      if (!plan && orders.length) {
        plan = {
          id: planId(), symbol, source: 'bitvavo',
          title: 'Órdenes en Bitvavo',
          note: 'Tramos creados a partir de tus órdenes de compra abiertas. Se actualizan al sincronizar.',
          budget: 0, createdAt: Date.now(), tranches: [], usedOps: [],
        };
        store.plans.push(plan);
        creados++;
      }
      if (!plan) continue;

      const abiertas = new Set(orders.map(o => o.orderId));
      // 1) tramos nuevos
      for (const o of orders) {
        const importe = round(o.price * (o.remaining || o.qty), 2);
        const tr = plan.tranches.find(x => x.orderId === o.orderId);
        if (tr) {
          tr.price = o.price;
          tr.amount = importe;
          tr.qty = o.remaining || o.qty;
          continue;
        }
        plan.tranches.push({
          id: planId(), price: o.price, amount: importe, qty: o.remaining || o.qty,
          status: 'pending', doneAt: null, donePrice: null, orderId: o.orderId,
          orderType: o.type, orderCreated: o.created,
        });
        nuevos++;
      }
      // 2) tramos cuya orden ya no está abierta en Bitvavo: si no se ejecutó, se borra
      //    (antes se quedaba como «cancelado» y el plan nunca desaparecía)
      plan.tranches = plan.tranches.filter(tr => {
        if (!tr.orderId) return true;
        if (abiertas.has(tr.orderId)) return true;
        if (tr.status === 'done') return true;          // se ejecutó: se conserva como histórico
        removePlanAlert(plan.id, tr.id);
        cerrados++;
        return false;                                    // la quitaron de Bitvavo: fuera
      });
      plan.tranches.sort((a, b) => b.price - a.price);
      plan.budget = round(plan.tranches.filter(x => x.status === 'pending').reduce((a, x) => a + x.amount, 0), 2);
    }

    // 3) planes importados que se han quedado sin tramos: se eliminan
    let planesBorrados = 0;
    store.plans = store.plans.filter(p => {
      if (p.source !== 'bitvavo') return true;
      if ((p.tranches || []).length) return true;
      planesBorrados++;
      return false;
    });

    savePlanStore(store);
    return { ok: true, planesCreados: creados, tramosNuevos: nuevos, tramosCerrados: cerrados, planesBorrados, errores, planes: store.plans };
  }
}

app.post('/api/plans/bitvavo-sync', async (req, res) => {
  try { res.json(await syncBitvavoPlans()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/plans', (req, res) => {
  const store = getPlanStore();
  autoMatchPlanBuys(store);
  for (const plan of store.plans) {
    for (const tr of plan.tranches) {
      if (tr.status === 'pending') ensurePlanAlert(plan, tr);
    }
  }
  res.json({ ok: true, plans: store.plans, prices: state.prices || {} });
});

app.post('/api/plans', (req, res) => {
  const b = req.body || {};
  const symbol = String(b.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  const tranches = (Array.isArray(b.tranches) ? b.tranches : [])
    .map(x => ({ price: Number(x && x.price), amount: Number(x && x.amount) }))
    .filter(x => x.price > 0 && x.amount > 0)
    .map(x => ({ id: planId(), price: x.price, amount: x.amount, status: 'pending', doneAt: null, donePrice: null }));
  if (!tranches.length) return res.status(400).json({ error: 'Añade al menos un tramo con precio e importe' });
  const store = getPlanStore();
  const plan = {
    id: planId(),
    symbol,
    title: String(b.title || '').slice(0, 90),
    note: String(b.note || '').slice(0, 500),
    budget: round(tranches.reduce((a, x) => a + x.amount, 0), 2),
    createdAt: Date.now(),
    tranches,
  };
  store.plans.push(plan);
  savePlanStore(store);
  for (const tr of plan.tranches) ensurePlanAlert(plan, tr);
  res.json({ ok: true, plan });
});

app.post('/api/plans/:id/tranche/:tid', (req, res) => {
  const store = getPlanStore();
  const plan = store.plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'No existe ese plan' });
  const tr = plan.tranches.find(x => x.id === req.params.tid);
  if (!tr) return res.status(404).json({ error: 'No existe ese tramo' });
  const status = String((req.body || {}).status || 'done');
  if (!['pending', 'done', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Estado no válido' });
  tr.status = status;
  tr.doneAt = status === 'done' ? Date.now() : null;
  tr.donePrice = status === 'done'
    ? (Number((req.body || {}).price) || Number((state.prices || {})[plan.symbol]) || tr.price)
    : null;
  if (status === 'pending') plan.reportSentAt = null;
  savePlanStore(store);
  if (status === 'pending') ensurePlanAlert(plan, tr);
  else removePlanAlert(plan.id, tr.id);

  // Informe automático: plan completado o cerrado con tramos cancelados
  if (status !== 'pending' && !plan.reportSentAt) {
    const pending = plan.tranches.filter(x => x.status === 'pending').length;
    const cancelled = plan.tranches.filter(x => x.status === 'cancelled').length;
    if (pending === 0) {
      plan.reportSentAt = Date.now();
      plan.reportKind = cancelled > 0 ? 'closed' : 'completed';
      savePlanStore(store);
      sendPlanReport(plan, plan.reportKind).catch(() => {});
    }
  }
  res.json({ ok: true, plan });
});

app.get('/api/plans/:id/report', (req, res) => {
  const plan = getPlanStore().plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).send('No existe ese plan');
  const cancelled = (plan.tranches || []).filter(x => x.status === 'cancelled').length;
  if (req.query.format === 'text') {
    return res.type('text/plain; charset=utf-8').send(buildPlanReportText(plan, cancelled > 0 ? 'closed' : 'completed'));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildPlanReportHtml(plan, cancelled > 0 ? 'closed' : 'completed'));
});

app.post('/api/plans/:id/report', async (req, res) => {
  const store = getPlanStore();
  const plan = store.plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'No existe ese plan' });
  const cancelled = (plan.tranches || []).filter(x => x.status === 'cancelled').length;
  const kind = cancelled > 0 ? 'closed' : 'completed';
  plan.reportSentAt = Date.now();
  plan.reportKind = kind;
  savePlanStore(store);
  await sendPlanReport(plan, kind);
  res.json({ ok: true, kind });
});

app.delete('/api/plans/:id', (req, res) => {
  const store = getPlanStore();
  const i = store.plans.findIndex(p => p.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No existe ese plan' });
  const removed = store.plans.splice(i, 1)[0];
  savePlanStore(store);
  removePlanAlerts(removed.id);
  const done = (removed.tranches || []).filter(x => x.status === 'done').length;
  if (done > 0 && !removed.reportSentAt) sendPlanReport(removed, 'closed').catch(() => {});
  res.json({ ok: true });
});

// ---------------- primera puesta en marcha ----------------
function hasAdmin() {
  return userStore.list().some(u => u.role === 'admin' && u.active !== false);
}

function legacyPending() {
  try { return fs.existsSync(LEGACY_FILES.ops) || fs.existsSync(LEGACY_FILES.settings); } catch { return false; }
}

app.get('/api/setup', (req, res) => {
  res.json({ ok: true, needed: !hasAdmin(), legacy: legacyPending() });
});

let setupBusy = false;
app.post('/api/setup', async (req, res) => {
  if (hasAdmin()) return res.status(400).json({ error: 'La instalación ya tiene administrador' });
  if (setupBusy) return res.status(409).json({ error: 'Ya se está creando el administrador' });
  setupBusy = true;
  try {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Usuario no válido (3-32 caracteres, sin espacios)' });
  }
  const problems = passwordProblems(String(b.password || ''));
  if (problems.length) return res.status(400).json({ error: 'La contraseña no cumple la política', problems });
  const legacy = legacyPending();
  const canData = legacy || b.canData !== false;
  const user = userStore.create({ username, email: String(b.email || '').trim(), role: 'admin', password: String(b.password || ''), mustChange: false, canData });
  if (legacy && canData) {
    const dir = userStore.userDir(user.id);
    for (const key of ['ops', 'history', 'holdings', 'overrides', 'settings', 'alerts', 'plans']) {
      const src = LEGACY_FILES[key];
      if (!src) continue;
      try { if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, path.basename(src))); } catch (e) { console.log('[setup]', key, e.message); }
    }
    for (const kind of ['wallpaper', 'avatar']) {
      for (const ext of ['.jpg', '.png', '.webp']) {
        const src = path.join(DATA_DIR, kind + ext);
        try { if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, kind + ext)); } catch {}
      }
    }
  }
  setSessionCookie(req, res, createSessionToken(COOKIE_SECRET, { u: user.id, v: user.sessionVersion || 1 }, SESSION_DAYS * 86400e3));
  res.json({ ok: true, user: userStore.publicUser(userStore.findById(user.id)) });
  } finally { setupBusy = false; }
});



// ---------------- certificado de la CA local ----------------
app.get('/api/ca.crt', (req, res) => {
  try {
    const f = path.join(DATA_DIR, 'ca.crt');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'No hay CA local' });
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="quanto-ca.crt"');
    res.send(fs.readFileSync(f));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- doble factor (TOTP) ----------------
async function qrDataUrl(texto) {
  if (!QRCode) return null;
  try { return await QRCode.toDataURL(texto, { margin: 1, width: 260, errorCorrectionLevel: 'M' }); }
  catch { return null; }
}

app.post('/api/login/2fa', (req, res) => {
  const ip = clientIp(req);
  const body = req.body || {};
  const ticket = String(body.ticket || '');
  const code = String(body.code || '');
  const payload = verifySessionToken(COOKIE_SECRET, ticket);
  if (!payload || !payload.tfa || !payload.u) {
    return res.status(401).json({ error: 'La verificación ha caducado. Vuelve a entrar.', code: 'expired' });
  }
  const user = userStore.findById(payload.u);
  if (!user || !user.totpEnabled) return res.status(401).json({ error: 'Cuenta no válida' });
  if ((user.sessionVersion || 1) !== payload.v) {
    return res.status(401).json({ error: 'La sesión ha cambiado. Vuelve a entrar.', code: 'expired' });
  }
  const limitUser = userLimiter.check('2fa:' + user.username.toLowerCase());
  if (!limitUser.allowed) {
    return res.status(429).json({ error: 'Demasiados códigos incorrectos. Espera unos minutos.' });
  }

  let ok = totp.verificar(user.totpSecret, code);
  let usadoRespaldo = false;
  if (!ok) {
    // código de respaldo (un solo uso)
    ok = userStore.consumeBackupCode(user.id, totp.hashCodigo(code));
    usadoRespaldo = ok;
  }
  if (!ok) {
    userLimiter.fail && userLimiter.fail('2fa:' + user.username.toLowerCase());
    return res.status(401).json({ error: 'Código incorrecto', code: 'bad' });
  }
  userLimiter.reset('2fa:' + user.username.toLowerCase());
  limiter.reset(ip);
  const fresh = userStore.findById(user.id);
  userStore.update(user.id, { lastLoginAt: Date.now(), lastSeenAt: Date.now(), loginCount: (fresh.loginCount || 0) + 1 });
  setSessionCookie(req, res, createSessionToken(COOKIE_SECRET, { u: user.id, v: fresh.sessionVersion || 1 }, SESSION_DAYS * 86400e3));
  res.json({ ok: true, user: userStore.publicUser(userStore.findById(user.id)), mustChange: !!fresh.mustChange, backupUsed: usadoRespaldo });
});



// ---------------- mercados y lista de vigilancia ----------------
let marketsCache = { at: 0, data: [] };

app.get('/api/markets', async (req, res) => {
  try {
    if (Date.now() - marketsCache.at < 60e3 && marketsCache.data.length) {
      return res.json({ ok: true, markets: marketsCache.data, cached: true });
    }
    const m = await fetchMarket();
    const lista = Object.entries(m.prices || {})
      .map(([symbol, price]) => ({ symbol, price, change: m.dayChange[symbol] }))
      .filter(x => x.price > 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    marketsCache = { at: Date.now(), data: lista };
    res.json({ ok: true, markets: lista, cached: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/watchlist', (req, res) => {
  const s = getSettings();
  res.json({ ok: true, watchlist: Array.isArray(s.watchlist) ? s.watchlist : [] });
});

app.post('/api/watchlist', (req, res) => {
  const b = req.body || {};
  const symbol = String(b.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  const s = getSettings();
  const lista = Array.isArray(s.watchlist) ? s.watchlist.slice() : [];
  const i = lista.indexOf(symbol);
  if (b.on === false) {
    if (i >= 0) lista.splice(i, 1);
  } else if (i < 0) {
    lista.push(symbol);
  }
  s.watchlist = lista.slice(0, 40);
  saveSettings(s);
  res.json({ ok: true, watchlist: s.watchlist });
});


// ---------------- alertas automáticas por porcentaje ----------------
const AUTO_WINDOW_MIN = 60;                 // ventana de 1 hora (13 velas de 5 min)
const AUTO_COOLDOWN_MS = 3 * 3600e3;        // no repetir el mismo aviso en 3 h
const autoLast = new Map();

function autoAlertCfg(s) {
  const a = (s && s.autoAlerts) || {};
  const num = (v, d) => {
    const n = Number(v);
    return isFinite(n) && n > 0 && n <= 90 ? n : d;
  };
  const win = Number(a.windowMin);
  const ventana = isFinite(win) && win >= 5 && win <= 1440 ? Math.round(win) : AUTO_WINDOW_MIN;
  return {
    drop: { on: !!(a.drop && a.drop.on), pct: num(a.drop && a.drop.pct, 6) },
    rise: { on: !!(a.rise && a.rise.on), pct: num(a.rise && a.rise.pct, 5) },
    windowMin: ventana,
  };
}

/** intervalo y número de velas para cubrir la ventana pedida */
function ventanaCandles(ventanaMin) {
  if (ventanaMin <= 60) return { intervalo: '5m', velas: Math.round(ventanaMin / 5) + 1 };
  if (ventanaMin <= 240) return { intervalo: '15m', velas: Math.round(ventanaMin / 15) + 1 };
  return { intervalo: '1h', velas: Math.round(ventanaMin / 60) + 1 };
}

function ventanaTexto(ventanaMin) {
  if (ventanaMin < 60) return `${ventanaMin} min`;
  const h = ventanaMin / 60;
  return h === 1 ? '1 hora' : `${h % 1 === 0 ? h : h.toFixed(1)} horas`;
}

async function sendAutoAlert(user, coin, dir, pct, umbral) {
  const clave = `${user.id}:${coin.symbol}:${dir}`;
  const ahora = Date.now();
  const cfg = autoAlertCfg(getSettings());
  const espera = Math.max(AUTO_COOLDOWN_MS, cfg.windowMin * 60e3);
  if (ahora - (autoLast.get(clave) || 0) < espera) return false;
  const precio = Number(coin.price) || 0;
  const media = coin.costKnown && coin.avgPrice ? Number(coin.avgPrice) : null;
  const diffMedia = media && media > 0 ? ((precio - media) / media) * 100 : null;
  const sube = dir === 'rise';
  const emoji = sube ? '📈' : '📉';
  const mov = sube ? 'sube' : 'cae';

  const ventana = ventanaTexto(cfg.windowMin);
  const texto = [
    `${emoji} <b>${escHtml(coin.symbol)}</b> ${mov} un <b>${nfPct.format(Math.abs(pct))} %</b> en ${ventana}`,
    '',
    `Precio ahora: <b>${moneySmart(precio)}</b>`,
    media ? `Tu precio medio: ${moneySmart(media)}${diffMedia === null ? '' : ` (${pctFmt(diffMedia)})`}` : 'Sin precio medio',
    `Aviso configurado: ${sube ? '+' : '−'}${nfPct.format(umbral)} % en ${ventana}`,
    '',
    tgLink(),
  ].filter(Boolean).join('\n');

  const asunto = `Quanto · ${coin.symbol} ${mov} ${nfPct.format(Math.abs(pct))} % en ${ventana}`;
  const html = buildAlertEmailHtml({
    simbolo: coin.symbol,
    sube,
    pct,
    precio,
    media,
    diff: diffMedia,
    umbral,
    ventana,
    efectivo: coin.amount > 0 ? Number(coin.amount) * precio : null,
    fecha: new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  });
  await notifyUser(texto, asunto, html);
  autoLast.set(clave, ahora);
  console.log(`[auto] ${user.username}: ${coin.symbol} ${mov} ${pct.toFixed(2)} % en 1 h`);
  return true;
}

async function checkAutoAlerts(user) {
  const s = getSettings();
  const cfg = autoAlertCfg(s);
  if (!cfg.drop.on && !cfg.rise.on) return;
  const p = state.portfolio;
  if (!p || !Array.isArray(p.coins) || !p.coins.length) return;

  for (const c of p.coins) {
    if (!(Number(c.amount) > 0)) continue;
    try {
      const vc = ventanaCandles(cfg.windowMin);
      const raw = await client.candles(`${c.symbol}-EUR`, vc.intervalo, vc.velas);
      if (!Array.isArray(raw) || raw.length < 3) continue;
      const closes = raw
        .map(k => Number(k && k[4]))
        .filter(n => isFinite(n) && n > 0)
        .reverse();
      if (closes.length < 2) continue;
      const primero = closes[0];
      const ultimo = closes[closes.length - 1];
      if (!(primero > 0)) continue;
      const pct = ((ultimo - primero) / primero) * 100;
      if (cfg.drop.on && pct <= -cfg.drop.pct) await sendAutoAlert(user, c, 'drop', pct, cfg.drop.pct);
      if (cfg.rise.on && pct >= cfg.rise.pct) await sendAutoAlert(user, c, 'rise', pct, cfg.rise.pct);
    } catch (e) { /* moneda sin velas de 5 min */ }
  }
}


// comprobación manual: devuelve cuánto se ha movido cada moneda en la última hora

// vista previa del correo de aviso (para revisarlo sin enviarlo)
app.get('/api/auto-alerts/preview', async (req, res) => {
  try {
    const cfg = autoAlertCfg(getSettings());
    const sym = String(req.query.symbol || '').toUpperCase();
    const p = state.portfolio || (await refreshPortfolio(false));
    const coins = (p && Array.isArray(p.coins)) ? p.coins : [];
    const coin = coins.find(c => c.symbol === sym) || coins[0];
    if (!coin) return res.status(404).send('Sin monedas en cartera');
    const html = buildAlertEmailHtml({
      simbolo: coin.symbol,
      sube: String(req.query.dir || 'drop') === 'rise',
      pct: Number(req.query.pct) || cfg.drop.pct,
      precio: Number(coin.price) || 0,
      media: coin.costKnown ? Number(coin.avgPrice) : null,
      diff: coin.costKnown && coin.avgPrice > 0 ? ((Number(coin.price) - Number(coin.avgPrice)) / Number(coin.avgPrice)) * 100 : null,
      umbral: cfg.drop.pct,
      ventana: ventanaTexto(cfg.windowMin),
      efectivo: Number(coin.amount) * Number(coin.price),
      fecha: new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get('/api/auto-alerts/check', async (req, res) => {
  try {
    const cfg = autoAlertCfg(getSettings());
    const p = state.portfolio || (await refreshPortfolio(false));
    const coins = (p && Array.isArray(p.coins)) ? p.coins.filter(c => Number(c.amount) > 0) : [];
    const filas = [];
    for (const c of coins) {
      try {
        const vc = ventanaCandles(cfg.windowMin);
        const raw = await client.candles(`${c.symbol}-EUR`, vc.intervalo, vc.velas);
        if (!Array.isArray(raw) || raw.length < 3) continue;
        const closes = raw.map(k => Number(k && k[4])).filter(n => isFinite(n) && n > 0).reverse();
        if (closes.length < 2) continue;
        const pct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
        filas.push({
          symbol: c.symbol,
          pct: Math.round(pct * 100) / 100,
          precio: Number(c.price) || null,
          disparaBajada: cfg.drop.on && pct <= -cfg.drop.pct,
          disparaSubida: cfg.rise.on && pct >= cfg.rise.pct,
        });
      } catch { /* sin velas */ }
    }
    filas.sort((a, b) => a.pct - b.pct);
    const enviar = String(req.query.send || '') === '1';
    let enviados = 0;
    if (enviar && (cfg.drop.on || cfg.rise.on)) {
      const antes = new Map(autoLast);
      await checkAutoAlerts(req.user);
      enviados = [...autoLast.keys()].filter(k => !antes.has(k)).length;
    }
    res.json({ ok: true, ventanaMin: cfg.windowMin, cfg, filas, enviados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auto-alerts', (req, res) => {
  const cfg = autoAlertCfg(getSettings());
  res.json({ ok: true, ...cfg, ventanaMin: cfg.windowMin });
});

app.post('/api/auto-alerts', (req, res) => {
  const b = req.body || {};
  const s = getSettings();
  const actual = autoAlertCfg(s);
  const limpiar = (v, def) => {
    const n = Number(v);
    return isFinite(n) ? Math.min(90, Math.max(0.5, Math.round(n * 10) / 10)) : def;
  };
  s.autoAlerts = {
    drop: { on: b.drop && b.drop.on !== undefined ? !!b.drop.on : actual.drop.on, pct: b.drop && b.drop.pct !== undefined ? limpiar(b.drop.pct, actual.drop.pct) : actual.drop.pct },
    rise: { on: b.rise && b.rise.on !== undefined ? !!b.rise.on : actual.rise.on, pct: b.rise && b.rise.pct !== undefined ? limpiar(b.rise.pct, actual.rise.pct) : actual.rise.pct },
  };
  if (b.windowMin !== undefined) {
    const w = Number(b.windowMin);
    s.autoAlerts.windowMin = isFinite(w) ? Math.min(1440, Math.max(5, Math.round(w))) : AUTO_WINDOW_MIN;
  } else if (!s.autoAlerts.windowMin) {
    s.autoAlerts.windowMin = AUTO_WINDOW_MIN;
  }
  s.autoAlerts.updatedAt = Date.now();
  saveSettings(s);
  res.json({ ok: true, ...s.autoAlerts, ventanaMin: s.autoAlerts.windowMin });
});

// ---------------- favoritos del usuario ----------------
app.get('/api/favorites', (req, res) => {
  const s = getSettings();
  res.json({ ok: true, favorites: Array.isArray(s.favorites) ? s.favorites : [] });
});

app.post('/api/favorites', (req, res) => {
  const b = req.body || {};
  const symbol = String(b.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  const s = getSettings();
  const lista = Array.isArray(s.favorites) ? s.favorites.slice() : [];
  const i = lista.indexOf(symbol);
  if (b.on === false) {
    if (i >= 0) lista.splice(i, 1);
  } else if (i < 0) {
    lista.push(symbol);
  }
  s.favorites = lista.slice(0, 30);
  saveSettings(s);
  res.json({ ok: true, favorites: s.favorites });
});

app.get('/api/2fa/status', (req, res) => {
  const u = req.user;
  res.json({ ok: true, enabled: !!u.totpEnabled, since: u.totpSince || null, backups: (u.totpBackup || []).length });
});

app.post('/api/2fa/setup', async (req, res) => {
  try {
    const secret = totp.nuevoSecreto();
    userStore.setTotpPending(req.user.id, secret);
    const uri = totp.uri(secret, req.user.username);
    res.json({ ok: true, secret, uri, qr: await qrDataUrl(uri) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/2fa/enable', (req, res) => {
  const u = userStore.findById(req.user.id);
  const code = String((req.body && req.body.code) || '');
  if (!u || !u.totpPending) return res.status(400).json({ error: 'Primero genera el código QR' });
  if (!totp.verificar(u.totpPending, code)) return res.status(400).json({ error: 'Ese código no es válido. Revisa la hora del móvil.' });
  const codes = totp.codigosRespaldo(10);
  userStore.enableTotp(u.id, u.totpPending, codes.map(totp.hashCodigo));
  res.json({ ok: true, backupCodes: codes });
});

app.post('/api/2fa/disable', (req, res) => {
  const u = userStore.findById(req.user.id);
  const code = String((req.body && req.body.code) || '');
  if (!u || !u.totpEnabled) return res.status(400).json({ error: 'El doble factor no está activo' });
  if (!totp.verificar(u.totpSecret, code)) return res.status(400).json({ error: 'Código incorrecto' });
  userStore.disableTotp(u.id);
  res.json({ ok: true });
});

app.post('/api/users/:id/2fa-reset', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador' });
  const target = userStore.findById(req.params.id);
  if (!target) return res.status(404).json({ error: 'No existe ese usuario' });
  userStore.disableTotp(target.id);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  const limit = limiter.check(ip);
  if (!limit.allowed) {
    return res.status(429).json({ error: `Demasiados intentos. Espera ${Math.ceil(limit.retryAfter / 60)} minutos.` });
  }
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
  const userKey = 'u:' + username.toLowerCase();
  const limitUser = userLimiter.check(userKey);
  if (!limitUser.allowed) {
    return res.status(429).json({ error: 'Demasiados intentos para este usuario. Espera unos minutos.' });
  }
  const out = userStore.login(username, password);
  if (out.error === 'invitacion-pendiente') {
    return res.status(403).json({ error: 'Tu cuenta está pendiente: abre el enlace de invitación que te enviaron', code: 'invite' });
  }
  if (out.error) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  limiter.reset(ip);
  userLimiter.reset(userKey);
  const user = out.user;

  // Con doble factor activo, la contraseña sola no abre sesión
  if (user.totpEnabled) {
    const ticket = createSessionToken(COOKIE_SECRET, { u: user.id, v: user.sessionVersion || 1, tfa: 1 }, 5 * 60e3);
    return res.json({ ok: true, need2fa: true, ticket });
  }

  setSessionCookie(req, res, createSessionToken(COOKIE_SECRET, { u: user.id, v: user.sessionVersion || 1 }, SESSION_DAYS * 86400e3));
  res.json({ ok: true, user: userStore.publicUser(user), mustChange: !!user.mustChange });
});

// Público: petición de reseteo (no revela si el usuario existe).
app.post('/api/forgot', (req, res) => {
  const ip = clientIp(req);
  const limit = forgotLimiter.check(ip);
  if (!limit.allowed) return res.status(429).json({ error: 'Demasiadas peticiones. Prueba más tarde.' });
  let asked = null;
  try { asked = userStore.requestReset(String((req.body && req.body.identifier) || '')); } catch {}
  if (asked) notifyAdminsReset(req, asked).catch(() => {});
  res.json({ ok: true, message: 'Aviso enviado al administrador' });
});

// Público: invitación / reseteo por token.
app.get('/api/invite/:token', (req, res) => {
  const user = userStore.inviteByToken(req.params.token);
  if (!user) return res.status(404).json({ error: 'Enlace no válido o caducado' });
  res.json({ ok: true, username: user.username, email: user.email || '' });
});

app.post('/api/invite/:token', (req, res) => {
  const out = userStore.acceptInvite(req.params.token, (req.body || {}).password);
  if (out.error === 'token') return res.status(404).json({ error: 'Enlace no válido o caducado' });
  if (out.error === 'politica') return res.status(400).json({ error: 'La contraseña no cumple la política', problems: out.problems });
  const user = out.user;
  setSessionCookie(req, res, createSessionToken(COOKIE_SECRET, { u: user.id, v: user.sessionVersion || 1 }, SESSION_DAYS * 86400e3));
  res.json({ ok: true, user: userStore.publicUser(user) });
});

// ---------------- privado ----------------
app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: userStore.publicUser(req.user) });
});

app.post('/api/password', (req, res) => {
  const b = req.body || {};
  if (!checkPassword(String(b.currentPassword || ''))) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  }
  const next = String(b.newPassword || '');
  const problems = passwordProblems(next);
  if (problems.length) return res.status(400).json({ error: 'La contraseña no cumple la política', problems });
  if (next === String(b.currentPassword || '')) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser distinta' });
  }
  const updated = userStore.setPassword(req.user.id, next, { mustChange: false });
  setSessionCookie(req, res, createSessionToken(COOKIE_SECRET, { u: updated.id, v: updated.sessionVersion }, SESSION_DAYS * 86400e3));
  res.json({ ok: true });
});

// ---------------- administración de usuarios ----------------
app.get('/api/users', requireAdmin, (req, res) => {
  res.json({ ok: true, users: userStore.list().map(userStore.publicUser) });
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Usuario no válido (3-32 caracteres, sin espacios)' });
  }
  if (userStore.findByUsername(username)) return res.status(400).json({ error: 'Ese usuario ya existe' });
  const email = String(b.email || '').trim();
  if (email && userStore.findByEmail(email)) return res.status(400).json({ error: 'Ese email ya está en uso' });
  const role = b.role === 'admin' ? 'admin' : 'user';
  const user = userStore.create({ username, email, role, mustChange: false });
  const invite = userStore.issueInvite(user.id, 72);
  const sent = await sendInviteEmail(req, user, invite.token);
  res.json({ ok: true, user: userStore.publicUser(userStore.findById(user.id)), inviteToken: invite.token, expiresAt: invite.expiresAt, emailSent: sent });
});

app.post('/api/users/:id/reset', requireAdmin, async (req, res) => {
  const user = userStore.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'No existe ese usuario' });
  userStore.setPassword(user.id, randomPassword(20), { mustChange: true });
  userStore.update(user.id, { inviteTokenHash: null, inviteExpiresAt: null, resetRequestedAt: null });
  const invite = userStore.issueInvite(user.id, 72);
  const sent = await sendInviteEmail(req, user, invite.token);
  res.json({ ok: true, inviteToken: invite.token, expiresAt: invite.expiresAt, emailSent: sent, user: userStore.publicUser(userStore.findById(user.id)) });
});

app.post('/api/users/:id/toggle', requireAdmin, (req, res) => {
  const user = userStore.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'No existe ese usuario' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  const updated = userStore.update(user.id, { active: user.active === false, sessionVersion: (user.sessionVersion || 1) + 1 });
  res.json({ ok: true, user: userStore.publicUser(updated) });
});

app.post('/api/users/:id/invite', requireAdmin, (req, res) => {
  const user = userStore.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'No existe ese usuario' });
  const invite = userStore.issueInvite(user.id, 72);
  res.json({ ok: true, inviteToken: invite.token, expiresAt: invite.expiresAt });
});

// ---------------- canales de aviso por usuario ----------------
function notifyChannels() {
  const cfg = notifyConfig();
  const tg = telegramConfig();
  return { telegram: !!(tg.token && tg.chatId), email: !!(cfg.emailEnabled && cfg.email) };
}

function notifyConfig() {
  const s = getSettings();
  const n = s.notify || {};
  return {
    email: String(n.email || '').trim(),
    emailEnabled: !!n.emailEnabled,
    telegramEnabled: n.telegramEnabled !== false,
  };
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
}

async function sendByEmail(to, subject, text) {
  if (!mailer.ready()) throw new Error('El envío de correo no está configurado por el administrador');
  return mailer.send({ to, subject, text });
}

/** Envía un aviso por los canales que el usuario tenga activos. */
async function notifyUser(text, subject = 'Aviso de Quanto', html = null) {
  const cfg = notifyConfig();
  const results = { telegram: null, email: null };
  const tg = telegramConfig();
  if (cfg.telegramEnabled && tg.token && tg.chatId) {
    try { await telegramSend(text); results.telegram = 'ok'; } catch (e) { results.telegram = e.message; }
  }
  if (cfg.emailEnabled && cfg.email) {
    try {
      const plain = text.replace(/<[^>]+>/g, '') + (publicUrl() ? '\n\nAbrir Quanto: ' + publicUrl() : '');
      await mailer.send({ to: cfg.email, subject, text: plain, html: html || undefined });
      results.email = 'ok';
    } catch (e) { results.email = e.message; }
  }
  return results;
}

app.get('/api/notify', (req, res) => {
  res.json({ ok: true, notify: notifyConfig(), mailReady: mailer.ready() });
});

app.post('/api/notify', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim();
  if (b.emailEnabled && !validEmail(email)) {
    return res.status(400).json({ error: 'Escribe un email válido para recibir avisos' });
  }
  const s = getSettings();
  s.notify = {
    email,
    emailEnabled: !!b.emailEnabled,
    telegramEnabled: b.telegramEnabled !== false,
  };
  saveSettings(s);
  res.json({ ok: true, notify: notifyConfig() });
});

app.post('/api/notify/test', async (req, res) => {
  const cfg = notifyConfig();
  const out = [];
  const tg = telegramConfig();
  if (cfg.telegramEnabled && tg.token && tg.chatId) {
    try { await telegramSend('🧪 <b>Quanto</b> · prueba de avisos por Telegram'); out.push('telegram'); } catch (e) { out.push('telegram: ' + e.message); }
  }
  if (cfg.emailEnabled && cfg.email) {
    try {
      await sendByEmail(cfg.email, 'Quanto · prueba de avisos', 'Si lees esto, los avisos por correo funcionan.');
      out.push('email');
    } catch (e) { out.push('email: ' + e.message); }
  }
  if (!out.length) return res.status(400).json({ error: 'Activa al menos un canal' });
  res.json({ ok: true, sent: out });
});


// ---------------- informe semanal en HTML ----------------
function escMail(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildWeeklyReportHtml() {
  const p = state.portfolio;
  // Formato español a mano: 1.234,56 (el contenedor a veces no agrupa por locale)
  const fmt = (value, dec) => {
    const neg = (Number(value) || 0) < 0;
    const s = Math.abs(Number(value) || 0).toFixed(dec);
    const [ent, frac] = s.split('.');
    const conPuntos = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + conPuntos + (frac ? ',' + frac : '');
  };
  const eur = (v) => fmt(v, 2) + ' €';
  const price = (v) => {
    const n = Number(v) || 0;
    return fmt(n, n < 1 ? 4 : n < 10 ? 3 : 2) + ' €';
  };
  const pct = (v) => (Number(v) >= 0 ? '+' : '') + fmt(v, 2) + ' %';
  const col = (v) => (v >= 0 ? '#0f9d58' : '#d93025');
  const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

  const rows = [];
  if (p && Array.isArray(p.coins)) {
    const top = p.coins.slice().sort((a, b) => b.value - a.value).slice(0, 8);
    for (const c of top) {
      rows.push(`<tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;font-weight:600">${escMail(c.symbol)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;text-align:right">${eur(c.value)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;text-align:right;color:${col(c.pnl)}">${c.pnl == null ? '—' : eur(c.pnl)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;text-align:right;color:#6b7a90">${c.pnlPct == null ? '—' : pct(c.pnlPct)}</td>
      </tr>`);
    }
  }

  const extra = [];
  try { if (liqCache.data && liqCache.data.state) extra.push(['Liquidez', liqCache.data.state.label, liqCache.data.change30]); } catch {}
  try { if (levCache.data && levCache.data.risk) extra.push(['Deuda', levCache.data.risk.label, null]); } catch {}
  try { if (pulseCache.data && pulseCache.data.breadth) extra.push(['Amplitud', pulseCache.data.breadth.up + '/' + pulseCache.data.breadth.total + ' en verde', null]); } catch {}
  try { if (pulseCache.data && pulseCache.data.funding) extra.push(['Funding', (pulseCache.data.funding.avg >= 0 ? '+' : '') + fmt(pulseCache.data.funding.avg, 3) + ' %', null]); } catch {}
  try { const fg = weeklyFng || state.fearGreed; if (fg && fg.value != null) extra.push(['Miedo/codicia', String(fg.value), null]); } catch {}

  let plansHtml = '';
  try {
    const store = getPlanStore();
    const items = [];
    for (const plan of store.plans || []) {
      const left = (plan.tranches || []).filter(x => x.status !== 'done');
      if (!left.length) continue;
      items.push(`<li style="margin:2px 0"><b>${escMail(plan.symbol)}</b> — faltan ${left.map(x => price(x.price)).join(' · ')}</li>`);
    }
    if (items.length) plansHtml = `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:22px 0 8px">Planes</h3><ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6">${items.join('')}</ul>`;
  } catch {}

  let newsHtml = '';
  try {
    const items = (newsCache.data && newsCache.data.items || []).slice(0, 3);
    if (items.length) {
      newsHtml = `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:22px 0 8px">Titulares</h3>` +
        items.map(n => `<div style="margin:0 0 10px"><div style="font-size:11px;color:#8a97ab;text-transform:uppercase;letter-spacing:.06em">${escMail(n.source)}</div>
          <a href="${escMail(n.link)}" style="color:#111;text-decoration:none;font-size:14px;line-height:1.35">${escMail(n.title)}</a></div>`).join('');
    }
  } catch {}

  const kpi = (label, value, sub, color) => `<td width="50%" style="padding:10px 12px;background:#f7f9fd;border-radius:12px">
      <div style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8a97ab">${label}</div>
      <div style="font-size:20px;font-weight:700;color:${color || '#0d1526'};margin-top:2px">${value}</div>
      <div style="font-size:11px;color:#8a97ab">${sub || ''}</div>
    </td>`;

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#eef1f7;padding:22px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f2">
    <div style="background:#0b1220;padding:18px 22px;color:#fff">
      <div style="font-size:18px;font-weight:700;letter-spacing:.08em">QUANTO</div>
      <div style="font-size:12px;color:#9aa8c2;margin-top:2px">Resumen semanal · ${escMail(today)}</div>
    </div>
    <div style="padding:20px 22px">
      <table width="100%" cellspacing="0" cellpadding="0"><tr>
        ${kpi('Valor total', eur(p && p.totalValue), p ? pct(p.pnlPct) + ' P/L' : '', '#0d1526')}
        ${kpi('Invertido', eur(p && p.invested), p ? (p.coinCount || 0) + ' monedas' : '')}
      </tr><tr><td style="height:8px"></td></tr><tr>
        ${kpi('P/L no realizado', eur(p && p.pnl), '', col(p && p.pnl))}
        ${kpi('Hoy', eur(p && p.dayChangeValue), p ? pct(p.dayChangePct) : '', col(p && p.dayChangeValue))}
      </tr></table>

      ${rows.length ? `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:22px 0 8px">Posiciones</h3>
      <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse">
        <tr><th align="left" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">Moneda</th>
            <th align="right" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">Valor</th>
            <th align="right" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">P/L</th>
            <th align="right" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">%</th></tr>
        ${rows.join('')}
      </table>` : ''}

      ${plansHtml}

      ${extra.length ? `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:22px 0 8px">Índices</h3>
      <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px">
        ${extra.map(([k, v, ch]) => `<tr><td style="padding:5px 0;color:#6b7a90">${escMail(k)}</td><td style="padding:5px 0;text-align:right;font-weight:600">${escMail(v)}${ch != null ? ' <span style="color:' + col(ch) + ';font-weight:400">(' + pct(ch) + ' 30 d)</span>' : ''}</td></tr>`).join('')}
      </table>` : ''}

      ${newsHtml}

      ${emailButton() ? `<div style="margin-top:24px;text-align:center">${emailButton()}</div>` : ''}
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eef1f7;font-size:11px;color:#8a97ab">
        Enviado por Quanto · puedes desactivarlo en Alertas → informes.
      </div>
    </div>
  </div>
</div>`;
}



// ---------------- formato para Telegram (HTML limitado) ----------------
function tgEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function tgNum(v, dec = 2) {
  const n = Number(v) || 0;
  const neg = n < 0;
  const s = Math.abs(n).toFixed(dec);
  const [en, fr] = s.split('.');
  return (neg ? '\u2212' : '') + en.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fr ? ',' + fr : '');
}
function tgMoney(v) { return tgNum(v, 2) + ' €'; }
function tgPrice(v) {
  const a = Math.abs(Number(v) || 0);
  return tgNum(v, a < 1 ? 4 : a < 10 ? 3 : 2) + ' €';
}
function tgPct(v, dec = 1) { return (Number(v) >= 0 ? '+' : '') + tgNum(v, dec) + ' %'; }
function tgPre(lines) { return '<pre>' + lines.map(l => tgEsc(l)).join('\n') + '</pre>'; }
function tgPad(s, w, right = false) {
  s = String(s);
  if (s.length >= w) return s.slice(0, w);
  const fill = ' '.repeat(w - s.length);
  return right ? fill + s : s + fill;
}
function tgLink(text) {
  const base = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : '';
  return base ? `\n<a href="${base}">Abrir Quanto</a>` : '';
}

// ---------------- informe de plan (HTML) ----------------
function planAverages(plan) {
  const buys = opsForView().filter(o => o.type === 'buy' && o.currency === plan.symbol);
  const sumBuys = (list) => list.reduce((a, o) => {
    const amt = Number(o.amount) || 0;
    const cost = Number(o.paidEur) || (Number(o.quotePrice) * amt) || Number(o.value) || 0;
    return { amt: a.amt + amt, cost: a.cost + cost };
  }, { amt: 0, cost: 0 });
  const planStart = Number(plan.createdAt) || 0;
  const antes = sumBuys(buys.filter(o => Number(o.ts) < planStart));
  const despues = sumBuys(buys);
  const avgBefore = antes.amt > 0 ? antes.cost / antes.amt : null;
  const coin = state.portfolio && Array.isArray(state.portfolio.coins)
    ? state.portfolio.coins.find(c => c.symbol === plan.symbol) : null;
  const avgAfter = despues.amt > 0 ? despues.cost / despues.amt : (coin ? coin.avgPrice : null);
  const mejoraPct = avgBefore && avgAfter ? ((avgAfter - avgBefore) / avgBefore) * 100 : null;
  return { avgBefore, avgAfter, mejoraPct };
}

function publicUrl() {
  return (process.env.PUBLIC_URL || '').replace(/\/$/, '');
}
function emailButton() {
  const base = publicUrl();
  if (!base) return '';
  return `<a href="${base}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:700">Abrir Quanto</a>`;
}


/** Correo HTML bonito para los avisos automáticos de movimiento. */
function buildAlertEmailHtml(d) {
  const f = (v, dec = 2) => {
    if (!isFinite(v)) return '—';
    const neg = v < 0;
    const s = Math.abs(v).toFixed(dec);
    const [en, fr] = s.split('.');
    return (neg ? '\u2212' : '') + en.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fr ? ',' + fr : '');
  };
  const px = (v) => {
    const a = Math.abs(Number(v) || 0);
    return f(v, a < 1 ? 4 : a < 10 ? 3 : 2) + ' €';
  };
  const color = d.sube ? '#0f9d58' : '#d93025';
  const flecha = d.sube ? '▲' : '▼';
  const base = publicUrl();
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f2f5fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 14px 40px -20px rgba(16,30,54,.35)">
    <div style="background:#0b1220;padding:20px 24px">
      <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.14em">QUANTO</div>
      <div style="color:#8fa3bf;font-size:12.5px;margin-top:2px">Aviso de movimiento · ${d.fecha}</div>
    </div>
    <div style="padding:24px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a97ab">${d.sube ? 'Subida rápida' : 'Bajada rápida'}</div>
      <h1 style="margin:6px 0 2px;font-size:24px;color:#0b1220">${d.simbolo} ${d.sube ? 'sube' : 'cae'} un ${f(Math.abs(d.pct), 2)} %</h1>
      <div style="color:#5b6b82;font-size:13px">en ${d.ventana}</div>

      <div style="margin:18px 0 4px;font-size:30px;font-weight:800;color:${color}">${flecha} ${px(d.precio)}</div>
      <div style="color:#8a97ab;font-size:13px">precio ahora mismo</div>

      <table style="width:100%;border-collapse:collapse;margin-top:18px">
        <tr>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;color:#8a97ab;font-size:12.5px">Tu precio medio</td>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;text-align:right;font-weight:700;color:#0b1220">${d.media ? px(d.media) : '—'}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;color:#8a97ab;font-size:12.5px">Respecto a tu media</td>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;text-align:right;font-weight:700;color:${d.diff === null ? '#0b1220' : d.diff >= 0 ? '#0f9d58' : '#d93025'}">${d.diff === null ? '—' : (d.diff >= 0 ? '+' : '') + f(d.diff, 2) + ' %'}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;color:#8a97ab;font-size:12.5px">Aviso configurado</td>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;text-align:right;font-weight:700;color:#0b1220">${d.sube ? '+' : '−'}${f(d.umbral, 2)} % en ${d.ventana}</td>
        </tr>
        ${d.efectivo !== null ? `<tr>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;color:#8a97ab;font-size:12.5px">Tu posición valdría</td>
          <td style="padding:10px 0;border-top:1px solid #eef1f7;text-align:right;font-weight:700;color:#0b1220">${px(d.efectivo)}</td>
        </tr>` : ''}
      </table>

      ${base ? `<div style="margin-top:22px;text-align:center"><a href="${base}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:700">Abrir Quanto</a></div>` : ''}
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eef1f7;font-size:11px;color:#8a97ab">
        Quanto · aviso automático de precio. Puedes desactivarlo en Alertas → Alertas automáticas.
      </div>
    </div>
  </div>
</body></html>`;
}

function buildPlanReportHtml(plan, kind) {
  const done = (plan.tranches || []).filter(x => x.status === 'done');
  const cancelled = (plan.tranches || []).filter(x => x.status === 'cancelled');
  const pending = (plan.tranches || []).filter(x => x.status === 'pending');
  const invested = done.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const coins = done.reduce((a, x) => {
    const p = Number(x.donePrice) || Number(x.price) || 0;
    return p > 0 ? a + (Number(x.amount) || 0) / p : a;
  }, 0);
  const avgPrice = coins > 0 ? invested / coins : null;
  const now = state.prices ? Number(state.prices[plan.symbol]) : null;
  const coin = state.portfolio && Array.isArray(state.portfolio.coins)
    ? state.portfolio.coins.find(c => c.symbol === plan.symbol) : null;

  const { avgBefore, avgAfter, mejoraPct } = planAverages(plan);

  const f = (v, d = 2) => {
    if (!isFinite(v)) return '—';
    const neg = v < 0;
    const s = Math.abs(v).toFixed(d);
    const [en, fr] = s.split('.');
    return (neg ? '\u2212' : '') + en.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fr ? ',' + fr : '');
  };
  const eur = (v) => f(v, 2) + ' €';
  const px = (v) => {
    const a = Math.abs(Number(v) || 0);
    return f(v, a < 1 ? 4 : a < 10 ? 3 : 2) + ' €';
  };
  const fecha = (ts) => ts ? new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const titulo = kind === 'completed' ? 'Plan completado' : 'Plan cerrado';
  const subtitulo = kind === 'completed'
    ? 'Todos los tramos ejecutados.'
    : `Cerrado con ${cancelled.length} tramo(s) sin ejecutar.`;

  const filas = (plan.tranches || []).map(x => {
    const estado = x.status === 'done' ? 'Ejecutado' : x.status === 'cancelled' ? 'Cancelado' : 'Pendiente';
    const color = x.status === 'done' ? '#0f9d58' : x.status === 'cancelled' ? '#d93025' : '#8a97ab';
    const real = x.status === 'done' ? px(x.donePrice || x.price) : '—';
    return `<tr>
      <td style="padding:8px 6px;border-bottom:1px solid #eef1f7">${px(x.price)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;text-align:right">${eur(x.amount)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;text-align:right">${real}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;text-align:right;color:${color};font-weight:600">${estado}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eef1f7;text-align:right;color:#8a97ab">${fecha(x.doneAt)}</td>
    </tr>`;
  }).join('');

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#eef1f7;padding:22px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f2">
    <div style="background:#0b1220;padding:18px 22px;color:#fff">
      <div style="font-size:18px;font-weight:700;letter-spacing:.08em">QUANTO</div>
      <div style="font-size:12px;color:#9aa8c2;margin-top:2px">${titulo} · ${plan.symbol}${plan.title ? ' · ' + escMail(plan.title) : ''}</div>
    </div>
    <div style="padding:20px 22px">
      <p style="margin:0 0 14px;font-size:14px;color:#33415c">${subtitulo}</p>

      <table width="100%" cellspacing="0" cellpadding="0"><tr>
        <td width="50%" style="padding:10px 12px;background:#f7f9fd;border-radius:12px">
          <div style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8a97ab">Invertido</div>
          <div style="font-size:20px;font-weight:700;color:#0d1526">${eur(invested)}</div>
          <div style="font-size:11px;color:#8a97ab">de ${eur(plan.budget)} de presupuesto</div>
        </td>
        <td width="8"></td>
        <td width="50%" style="padding:10px 12px;background:#f7f9fd;border-radius:12px">
          <div style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8a97ab">Precio medio de compra</div>
          <div style="font-size:20px;font-weight:700;color:#0d1526">${avgPrice ? px(avgPrice) : '—'}</div>
          <div style="font-size:11px;color:#8a97ab">${f(coins, 4)} ${escMail(plan.symbol)} comprados</div>
        </td>
      </tr></table>

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:22px 0 8px">Tramos</h3>
      <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse">
        <tr>
          <th align="left" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">Objetivo</th>
          <th align="right" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">Importe</th>
          <th align="right" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">Comprado a</th>
          <th align="right" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">Estado</th>
          <th align="right" style="padding:6px;font-size:10px;color:#8a97ab;text-transform:uppercase">Fecha</th>
        </tr>
        ${filas}
      </table>

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:22px 0 8px">Tu precio medio</h3>
      <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px">
        <tr>
          <td width="31%" style="padding:10px 12px;background:#f7f9fd;border-radius:12px">
            <div style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8a97ab">Antes del plan</div>
            <div style="font-size:18px;font-weight:700;color:#0d1526">${avgBefore ? px(avgBefore) : '—'}</div>
          </td>
          <td width="8"></td>
          <td width="31%" style="padding:10px 12px;background:#f7f9fd;border-radius:12px">
            <div style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8a97ab">Después del plan</div>
            <div style="font-size:18px;font-weight:700;color:${mejoraPct != null && mejoraPct < 0 ? '#0f9d58' : '#0d1526'}">${avgAfter ? px(avgAfter) : '—'}</div>
          </td>
          <td width="8"></td>
          <td width="31%" style="padding:10px 12px;background:#f7f9fd;border-radius:12px">
            <div style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8a97ab">Mejora</div>
            <div style="font-size:18px;font-weight:700;color:${mejoraPct != null && mejoraPct < 0 ? '#0f9d58' : '#d93025'}">${mejoraPct != null ? f(mejoraPct, 2) + ' %' : '—'}</div>
          </td>
        </tr>
      </table>
      ${mejoraPct != null ? `<p style="margin:10px 0 0;font-size:12.5px;color:#33415c">${mejoraPct < 0
        ? 'El plan ha bajado tu precio medio en ' + f(Math.abs(mejoraPct), 2) + ' % (' + px(Math.abs(avgBefore - avgAfter)) + ' por moneda).'
        : 'Tu precio medio ha subido un ' + f(mejoraPct, 2) + ' %: las compras del plan se hicieron por encima de tu media anterior.'}</p>` : ''}

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:22px 0 8px">Resultado</h3>
      <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px">
        ${avgPrice && now ? `<tr><td style="padding:5px 0;color:#6b7a90">Precio ahora</td><td style="padding:5px 0;text-align:right;font-weight:600">${px(now)}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7a90">Vs. tu media de compra</td><td style="padding:5px 0;text-align:right;font-weight:600;color:${now >= avgPrice ? '#0f9d58' : '#d93025'}">${f(((now - avgPrice) / avgPrice) * 100, 2)} %</td></tr>` : ''}
        ${coin ? `<tr><td style="padding:5px 0;color:#6b7a90">Posición ahora</td><td style="padding:5px 0;text-align:right;font-weight:600">${px(coin.value)} · ${f(coin.amount, 4)} ${escMail(plan.symbol)}</td></tr>` : ''}
        ${pending.length ? `<tr><td style="padding:5px 0;color:#6b7a90">Sin ejecutar</td><td style="padding:5px 0;text-align:right;font-weight:600;color:#d93025">${pending.map(x => px(x.price)).join(' · ')}</td></tr>` : ''}
      </table>

      ${emailButton() ? `<div style="margin-top:24px;text-align:center">${emailButton()}</div>` : ''}
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eef1f7;font-size:11px;color:#8a97ab">
        Informe generado por Quanto · ${fecha(Date.now())}
      </div>
    </div>
  </div>
</div>`;
}

function buildPlanReportText(plan, kind) {
  const done = (plan.tranches || []).filter(x => x.status === 'done');
  const cancelled = (plan.tranches || []).filter(x => x.status === 'cancelled');
  const pending = (plan.tranches || []).filter(x => x.status === 'pending');
  const invested = done.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const coins = done.reduce((a, x) => {
    const p = Number(x.donePrice) || Number(x.price) || 0;
    return p > 0 ? a + (Number(x.amount) || 0) / p : a;
  }, 0);
  const avgPlan = coins > 0 ? invested / coins : null;
  const { avgBefore, avgAfter, mejoraPct } = planAverages(plan);

  const head = kind === 'completed' ? '✅ <b>PLAN COMPLETADO</b>' : '⛔ <b>PLAN CERRADO</b>';
  const lines = [head + ' · ' + tgEsc(plan.symbol) + (plan.title ? '\n<i>' + tgEsc(plan.title) + '</i>' : '')];

  lines.push('', tgPre([
    tgPad('Invertido', 12) + tgPad(tgMoney(invested), 13, true),
    tgPad('Presupuesto', 12) + tgPad(tgMoney(plan.budget), 13, true),
    tgPad('Medio plan', 12) + tgPad(avgPlan ? tgPrice(avgPlan) : '—', 13, true),
  ]));

  if (avgBefore && avgAfter) {
    lines.push('', '<b>TU MEDIA</b>');
    lines.push(tgPre([
      tgPad('Antes', 10) + tgPad(tgPrice(avgBefore), 12, true),
      tgPad('Después', 10) + tgPad(tgPrice(avgAfter), 12, true),
      tgPad('Mejora', 10) + tgPad(mejoraPct != null ? tgPct(mejoraPct, 2) : '—', 12, true),
    ]));
  }

  lines.push('', '<b>TRAMOS</b>');
  lines.push(tgPre((plan.tranches || []).map(x => {
    const estado = x.status === 'done' ? 'ejecutado' : x.status === 'cancelled' ? 'cancelado' : 'pendiente';
    return tgPad(tgPrice(x.price), 10) + tgPad(tgMoney(x.amount), 10, true) + '  ' + estado;
  })));

  if (pending.length) {
    lines.push('', '⚠️ Sin ejecutar: ' + pending.map(x => tgPrice(x.price)).join(' · '));
  }
  lines.push(tgLink());
  return lines.join('\n');
}

async function sendPlanReport(plan, kind) {
  const html = buildPlanReportHtml(plan, kind);
  const text = buildPlanReportText(plan, kind);
  try {
    const label = kind === 'completed' ? 'Plan completado' : 'Plan cerrado';
  await notifyUser(text, 'Quanto · ' + label + ': ' + plan.symbol, html);
  } catch (e) { console.log('[plan informe]', e.message); }
}

// ---------------- informe semanal ----------------
function weekKey(d = new Date()) {
  const t = new Date(d.getTime());
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day);
  return t.toISOString().slice(0, 10);
}

let weeklyFng = null;
async function prepareWeekly() {
  try {
    const fg = await getFearGreed(DATA_DIR);
    if (fg && fg.value != null) weeklyFng = fg;
  } catch (e) { /* sin indice */ }
  try {
    if (!newsCache.data || !newsCache.data.items || !newsCache.data.items.length) {
      const coins = ((state.portfolio && state.portfolio.coins) || []).map(c => c.symbol);
      const n = await getNews({ coins, limit: 20 });
      newsCache = { at: Date.now(), key: coins.join(','), data: n };
    }
  } catch (e) { /* sin noticias */ }
}

function buildWeeklyReport() {
  const p = state.portfolio;
  let outBase = null;
  let outDays = 0;
  const now = new Date();
  const lines = [];
  lines.push('📊 <b>RESUMEN SEMANAL</b>');
  lines.push('<i>' + now.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) + '</i>');

  if (!p) {
    lines.push('', 'Todavía no hay cartera.');
  } else {
    // Referencia: el último snapshot anterior a hace 7 días (o el más antiguo que haya)
    const cutoff = Date.now() - 7 * 86400e3;
    const before = state.snapshots.filter(s => s.t <= cutoff);
    const base = before.length ? before[before.length - 1] : (state.snapshots[0] || null);
    const days = base ? Math.max(1, Math.round((Date.now() - base.t) / 86400e3)) : 0;
    const change = base && base.value ? ((p.totalValue - base.value) / base.value) * 100 : 0;
    outBase = base && base.value ? base.value : null;
    outDays = days;
    lines.push('');
    lines.push(tgPre([
      tgPad('Valor', 12) + tgPad(tgMoney(p.totalValue), 14, true),
      tgPad('Invertido', 12) + tgPad(tgMoney(p.invested), 14, true),
      tgPad('P/L', 12) + tgPad(tgMoney(p.pnl), 14, true),
      tgPad(days >= 6 ? 'Semana' : ('Últ. ' + days + ' d'), 12) + tgPad(tgPct(change, 2), 14, true),
    ]));
    if (p.cash) lines.push('Efectivo: <b>' + tgMoney(p.cash) + '</b>');

    const top = (p.coins || []).slice().sort((a, b) => b.value - a.value).slice(0, 5);
    if (top.length) {
      lines.push('', '<b>POSICIONES</b>');
      lines.push(tgPre(top.map(c => tgPad(c.symbol, 7) + tgPad(tgMoney(c.value), 12, true) + tgPad(c.pnlPct == null ? '—' : tgPct(c.pnlPct, 1), 9, true))));
    }
  }

  try {
    const store = getPlanStore();
    const pend = [];
    for (const plan of store.plans || []) {
      const left = (plan.tranches || []).filter(x => x.status !== 'done');
      if (left.length) pend.push('• ' + plan.symbol + ': faltan ' + left.map(x => tgPrice(x.price)).join(' · '));
    }
    if (pend.length) lines.push('', '<b>PLANES</b>', ...pend);
  } catch {}

  const idx = [];
  try { if (liqCache.data && liqCache.data.state) idx.push('• Liquidez: ' + liqCache.data.state.label + ' (' + tgPct(liqCache.data.change30, 1) + ' 30 d)'); } catch {}
  try { if (levCache.data && levCache.data.risk) idx.push('• Deuda: ' + levCache.data.risk.label); } catch {}
  try { if (pulseCache.data && pulseCache.data.breadth) idx.push('• Amplitud: ' + pulseCache.data.breadth.up + '/' + pulseCache.data.breadth.total + ' en verde'); } catch {}
  try { const fg = weeklyFng || state.fearGreed; if (fg && fg.value != null) idx.push('• Miedo/codicia: ' + fg.value); } catch {}
  if (idx.length) lines.push('', '<b>ÍNDICES</b>', ...idx);

  try {
    const news = (newsCache.data && newsCache.data.items || []).slice(0, 2);
    if (news.length) {
      lines.push('', '<b>TITULARES</b>');
      for (const n of news) lines.push('• <a href="' + tgEsc(n.link) + '">' + tgEsc(n.title) + '</a>');
    }
  } catch {}

  lines.push(tgLink());
  return lines.filter(l => l !== null && l !== undefined).join('\n');
}

async function sendWeeklyReport() {
  await prepareWeekly();
  const n = notifyConfig();
  const tg = telegramConfig();
  const canTelegram = n.telegramEnabled && tg.token && tg.chatId;
  const canEmail = n.emailEnabled && n.email && mailer.ready();
  if (!canTelegram && !canEmail) return { ok: false, reason: 'sin-canal' };
  const text = buildWeeklyReport();
  const html = buildWeeklyReportHtml();
  const n2 = notifyConfig();
  const r = { telegram: null, email: null };
  if (canTelegram) { try { await telegramSend(text); r.telegram = 'ok'; } catch (e) { r.telegram = e.message; } }
  if (canEmail) { try { await mailer.send({ to: n2.email, subject: 'Quanto · resumen semanal', text: text.replace(/<[^>]+>/g, ''), html }); r.email = 'ok'; } catch (e) { r.email = e.message; } }
  const sent = r.telegram === 'ok' || r.email === 'ok';
  return sent ? { ok: true, channels: r } : { ok: false, reason: JSON.stringify(r) };
}

setInterval(() => {
  const now = new Date();
  if (now.getDay() !== 0 || now.getHours() !== 9) return; // domingo a las 9
  tenant.forEachUser((user) => {
    const s = getSettings();
    const w = s.weekly || {};
    if (!w.enabled) return;
    if (s.weeklySent === weekKey(now)) return;
    if (!state.portfolio) return;
    sendWeeklyReport().then(r => {
      if (r.ok) {
        const st = getSettings();
        st.weeklySent = weekKey(now);
        saveSettings(st);
        console.log('[semanal] enviado a', user.username);
      }
    });
  });
}, 30 * 60e3);

app.post('/api/weekly', (req, res) => {
  const enabled = !!(req.body || {}).enabled;
  const s = getSettings();
  s.weekly = { enabled };
  if (!enabled) s.weeklySent = null;
  saveSettings(s);
  res.json({ ok: true, weekly: s.weekly });
});

app.get('/api/weekly/preview', async (req, res) => {
  await prepareWeekly();
  if (req.query.format === 'text') return res.type('text/plain; charset=utf-8').send(buildWeeklyReport());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildWeeklyReportHtml());
});

app.post('/api/weekly/send', async (req, res) => {
  const r = await sendWeeklyReport();
  if (!r.ok) return res.status(400).json({ error: r.reason === 'sin-canal' ? 'Activa Telegram o email en Alertas' : r.reason });
  const s = getSettings();
  s.weeklySent = weekKey(new Date());
  saveSettings(s);
  res.json({ ok: true });
});

// ---------------- correo de avisos (solo admin) ----------------
app.get('/api/mail', requireAdmin, (req, res) => {
  res.json({ ok: true, mail: mailer.publicConfig() });
});

app.post('/api/mail', requireAdmin, (req, res) => {
  const b = req.body || {};
  const host = String(b.host || '').trim();
  const user = String(b.user || '').trim();
  if (!host) return res.status(400).json({ error: 'Falta el servidor SMTP' });
  if (!user) return res.status(400).json({ error: 'Falta el usuario' });
  const patch = {
    host,
    port: Number(b.port) || (b.secure === false ? 587 : 465),
    secure: b.secure !== false,
    user,
    from: String(b.from || user).trim(),
    fromName: String(b.fromName || 'Quanto').trim(),
  };
  const pass = String(b.pass || '');
  if (pass && pass !== '__KEEP__') patch.pass = pass;
  mailer.save(patch);
  res.json({ ok: true, mail: mailer.publicConfig() });
});

app.post('/api/mail/test', requireAdmin, async (req, res) => {
  const to = String((req.body || {}).to || req.user.email || '').trim();
  if (!to) return res.status(400).json({ error: 'Indica un email de destino' });
  try {
    await mailer.verify();
    await mailer.send({
      to,
      subject: 'Quanto · correo de prueba',
      text: 'Si estás leyendo esto, el correo de Quanto funciona correctamente.',
    });
    res.json({ ok: true, to });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function mailBaseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function sendInviteEmail(req, user, token) {
  if (!user.email || !mailer.ready()) return false;
  const link = `${mailBaseUrl(req)}/#/invite/${token}`;
  try {
    await mailer.send({
      to: user.email,
      subject: 'Te han invitado a Quanto',
      text: `Hola ${user.username},\n\nTe han invitado a Quanto. Crea tu contraseña aquí (caduca en 72 horas):\n${link}\n\nSi no esperabas este correo, ignóralo.`,
      html: `<p>Hola <b>${user.username}</b>,</p><p>Te han invitado a <b>Quanto</b>. Crea tu contraseña (caduca en 72 horas):</p><p><a href="${link}">${link}</a></p>`,
    });
    return true;
  } catch (e) {
    console.log('[mail] invitación:', e.message);
    return false;
  }
}

async function notifyAdminsReset(req, user) {
  if (!mailer.ready()) return;
  const admins = userStore.list().filter(u => u.role === 'admin' && u.email && u.active !== false);
  for (const admin of admins) {
    try {
      await mailer.send({
        to: admin.email,
        subject: `Quanto · ${user.username} pide restablecer su contraseña`,
        text: `${user.username} ha pedido restablecer su contraseña.\nEntra en Quanto → Ajustes → Usuarios y pulsa "Resetear".`,
      });
    } catch (e) { console.log('[mail] aviso admin:', e.message); }
  }
}

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const user = userStore.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'No existe ese usuario' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'No puedes borrar tu propia cuenta' });
  tenant.forget(user.id);
  userStore.remove(user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  let ok = false;
  try { ok = !!sessionPayload(req); } catch {}
  res.json({ ok });
});

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

async function buildEvolution(until) {
  const ops = opsForView();
  if (!ops.length) return { ok: false, points: [] };
  if (state.mode === 'demo' && !state.ops.length) {
    const points = demoEvolution(state.prices);
    return { ok: true, points, demo: true, from: points.length ? points[0].t : null, to: points.length ? points[points.length - 1].t : null };
  }
  const symbols = [...new Set(ops.filter(o => o.currency && o.currency !== 'EUR').map(o => o.currency))];
  const today = new Date().toISOString().slice(0, 10);
  if (!until && state.evolutionCache.data && state.evolutionCache.day === today) {
    return state.evolutionCache.data;
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
  const points = evolutionSeries(ops, prices, { until });
  const payload = { ok: true, points, symbols, from: points.length ? points[0].t : null, to: points.length ? points[points.length - 1].t : null };
  if (!until) state.evolutionCache = { at: Date.now(), day: today, data: payload };
  return payload;
}

app.get('/api/evolution', async (req, res) => {
  try {
    res.json(await buildEvolution(req.query.until));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// TWR: rentabilidad limpia (sin contar aportaciones) frente a mantener BTC.
app.get('/api/twr', async (req, res) => {
  const raw = String(req.query.days || '').toLowerCase();
  const days = raw === 'all' ? null : Math.min(3650, Math.max(7, Number(req.query.days) || 365));
  try {
    const evo = await buildEvolution();
    const points = evo.points || [];
    if (!points.length) return res.json({ ok: false, error: 'Sin histórico de cartera todavía.' });
    let btc = [];
    try {
      const candles = await client.candles('BTC-EUR', '1d', 1000);
      btc = (Array.isArray(candles) ? candles : [])
        .map(c => ({ t: Number(c[0]), close: parseFloat(c[4]) }))
        .filter(p => isFinite(p.close))
        .sort((a, b) => a.t - b.t);
    } catch { /* sin benchmark */ }
    const out = computeTwr({ points, ops: opsForView(), btc, days });
    res.json({ ...out, symbol: 'BTC', daysParam: raw || '365', mode: state.mode });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo calcular: ' + e.message });
  }
});

;

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
      const value = price > 0 ? round(item.amount * price, 2) : null;
      let sellGain = null;
      let sellTax = null;
      if (value !== null) {
        try {
          const sim = simulateSale(ops, item.symbol, item.amount);
          sellGain = round(value - sim.fifoCost, 2);
          sellTax = sellGain > 0 ? round(estimateTax(sellGain), 2) : 0;
        } catch { /* sin datos suficientes */ }
      }
      return {
        ...item,
        price,
        hasPrice: price > 0,
        value,
        pnl: value === null ? null : round(value - item.cost, 2),
        sellGain,
        sellTax,
      };
    }).sort((a, b) => (b.value || 0) - (a.value || 0));
    const invTotal = inventory.reduce((a, i) => a + (i.value || 0), 0);
    for (const i of inventory) i.weight = invTotal > 0 && i.value !== null ? round((i.value / invTotal) * 100, 1) : null;
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


// ---------------- simulador: comprar hoy y vender a un precio objetivo ----------------
app.get('/api/simulate/buy', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase();
    const qty = Number(req.query.qty) || 0;
    const target = Number(req.query.target) || 0;
    if (!symbol || qty <= 0 || target <= 0) return res.status(400).json({ error: 'Faltan datos' });

    let coin = ((state.portfolio && state.portfolio.coins) || []).find(c => c.symbol === symbol);
    if (!coin) {
      // moneda en seguimiento (sin posición): se simula desde cero
      try { if (!state.prices || !state.prices[symbol]) await fetchMarket(); } catch {}
      const precioMercado = Number(state.prices && state.prices[symbol]) || 0;
      if (!precioMercado) return res.status(400).json({ error: 'No hay precio de mercado para esa moneda' });
      coin = { symbol, amount: 0, price: precioMercado, avgPrice: 0, invested: 0, value: 0, costKnown: false };
    }

    const mercado = Number(coin.price) || Number(state.prices[symbol]) || 0;
    if (!mercado) return res.status(400).json({ error: 'No hay precio de mercado' });

    const ops = opsForView();
    const sim = (Number(coin.amount) > 0 && ops.length)
      ? simulateSale(ops, symbol, Number(coin.amount) || 0)
      : { fifoCost: Number(coin.invested) || 0 };
    const costeBase = Number(sim.fifoCost) || 0;

    const costeCompra = round(qty * mercado, 2);
    const totalQty = (Number(coin.amount) || 0) + qty;
    const totalInvertido = costeBase + costeCompra;

    const ingreso = round(totalQty * target, 2);
    const ganancia = round(ingreso - totalInvertido, 2);
    const impuestos = estimateTax(ganancia);
    const neto = round(ingreso - impuestos, 2);

    const ingreso0 = round((Number(coin.amount) || 0) * target, 2);
    const ganancia0 = round(ingreso0 - costeBase, 2);
    const impuestos0 = estimateTax(ganancia0);
    const neto0 = round(ingreso0 - impuestos0, 2);

    res.json({
      ok: true, symbol, mercado, target, qty, costeCompra,
      antes: {
        cantidad: Number(coin.amount) || 0, invertido: costeBase,
        media: coin.amount > 0 ? costeBase / coin.amount : 0,
        ingreso: ingreso0, ganancia: ganancia0, impuestos: impuestos0, neto: neto0,
        beneficioNeto: round(neto0 - costeBase, 2),
      },
      despues: {
        cantidad: totalQty, invertido: totalInvertido,
        media: totalQty > 0 ? totalInvertido / totalQty : 0,
        ingreso, ganancia, impuestos, neto,
        beneficioNeto: round(neto - totalInvertido, 2),
      },
      diferencia: {
        // lo que de verdad cambia: beneficio neto despues de descontar tambien el dinero aportado
        neto: round(neto - neto0, 2),
        ganancia: round(ganancia - ganancia0, 2),
        invertido: costeCompra,
        beneficioNeto: round((neto - totalInvertido) - (neto0 - costeBase), 2),
        rentabilidad: costeCompra > 0
          ? round((((neto - totalInvertido) - (neto0 - costeBase)) / costeCompra) * 100, 1)
          : null,
      },
    });
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
      remaining: round(Math.max(0, sim.available - amount), 8),
      remainingValue: round(Math.max(0, sim.available - amount) * price, 2),
      weightBefore: (() => {
        const total = Number(state.portfolio && state.portfolio.totalValue) || 0;
        return total > 0 ? round((sim.available * price / total) * 100, 1) : null;
      })(),
      weightAfter: (() => {
        const total = Number(state.portfolio && state.portfolio.totalValue) || 0;
        if (!(total > 0)) return null;
        const tax = estimateTax(fifoGain);
        const newTotal = Math.max(0.01, total - tax);
        return round((Math.max(0, sim.available - amount) * price / newTotal) * 100, 1);
      })(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- importaciones ----------------
app.post('/api/import/history', limitHeavy, (req, res) => {
  const text = String((req.body && req.body.text) || '');
  if (text.trim().length < 20) return res.status(400).json({ error: 'Pega o sube el CSV del historial completo de Bitvavo.' });
  let ops = [];
  try { ops = parseBitvavoHistory(text); } catch (e) { console.log('[import]', e.message); }
  if (!ops.length) {
    return res.status(400).json({ error: 'No he reconocido el archivo. En Bitvavo: Historial → descargar CSV (el completo, no el de la cartera).' });
  }
  // Copia de seguridad del historial actual antes de tocar nada.
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  let backup = null;
  try {
    if (fs.existsSync(FILES.ops)) {
      fs.copyFileSync(FILES.ops, FILES.ops + '.bak-' + stamp);
      backup = stamp;
    }
  } catch (e) { console.log('[import] copia:', e.message); }

  // Nunca se reemplaza: se fusiona con lo que ya hay.
  const before = state.ops.length;
  const merged = mergeOps(state.ops, ops);
  state.ops = merged.ops;
  state.meta = {
    importedAt: state.meta.importedAt || Date.now(),
    lastImportAt: Date.now(),
    autoCaptured: state.meta.autoCaptured || 0,
    lastSyncAt: state.meta.lastSyncAt,
    source: state.meta.source || 'csv',
  };
  refreshAnalysis();
  saveOps();
  state.evolutionCache = { at: 0, day: '', data: null };
  state.portfolioAt = 0;
  const stats = analyze(state.ops);
  console.log(`[import] ${state.ops.length} operaciones de ${Object.keys(stats.byCoin).length} monedas`);
  res.json({
    ok: true,
    ops: state.ops.length,
    added: merged.added,
    before,
    backup,
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
const alertsFile = () => path.join(tenant.ctx().files.dir, 'alerts.json');
const ALERT_CHECK_MS = 60e3;
let alertBusy = false;
let lastAlertRefresh = 0;

function getAlertStore() {
  const s = readJson(alertsFile(), null);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { rules: [] };
  if (!Array.isArray(s.rules)) s.rules = [];
  return s;
}
function saveAlertStore(s) { writeJson(alertsFile(), s); }

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
  const price = Number(coin.price) || 0;
  const above = rule.op === 'above';
  const emoji = above ? '📈' : '📉';
  const titulo = above ? 'ha llegado a tu precio máximo establecido' : 'ha llegado a tu precio mínimo establecido';
  const avg = coin.costKnown && coin.avgPrice ? Number(coin.avgPrice) : null;
  const diff = avg && avg > 0 ? ((price - avg) / avg) * 100 : null;

  const lines = [];
  lines.push(`${emoji} <b>${escHtml(coin.symbol)}</b> ${titulo}`);
  lines.push(`Precio fijado: ${moneySmart(rule.price)}`);
  lines.push('');
  lines.push(`Precio ahora: <b>${moneySmart(price)}</b>${coin.dayChangePct === null || coin.dayChangePct === undefined ? '' : ` (${pctFmt(coin.dayChangePct)} hoy)`}`);
  if (diff !== null) {
    lines.push(`Tu precio medio: ${moneySmart(avg)}`);
    lines.push(diff >= 0
      ? `Estás un <b>${nfPct.format(diff)} %</b> por encima de tu media 🟢`
      : `Estás un <b>${nfPct.format(Math.abs(diff))} %</b> por debajo de tu media 🔴`);
  } else {
    lines.push('Tu precio medio: no disponible');
  }

  // En los avisos de máximo, si vender ahora deja beneficio, lo decimos (FIFO, igual que el informe).
  if (above) {
    try {
      const ops = opsForView();
      const amount = Number(coin.amount) || 0;
      if (ops.length && amount > 0) {
        const sim = simulateSale(ops, coin.symbol, amount);
        if (sim.matchedAmount > 0) {
          const gain = round(amount * price - sim.fifoCost, 2);
          if (gain > 0) {
            const tax = estimateTax(gain);
            const net = round(gain - tax, 2);
            lines.push('');
            lines.push(`💰 Si vendes ahora: <b>+${money(gain)}</b> de beneficio`);
            lines.push(`🧾 Impuestos estimados: ${money(tax)} → te quedarían <b>+${money(net)}</b>`);
          }
        }
      }
    } catch (e) { console.log('[alertas] beneficio:', e.message); }
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
      const coolMs = Math.max(5, Number(rule.cooldownMin) || 15) * 60e3;
      const cooled = !rule.lastSentAt || Date.now() - rule.lastSentAt > coolMs;
      if (hit && armed && cooled) {
        try {
          await notifyUser(alertMessage(rule, coin), 'Quanto · ' + rule.symbol + (rule.op === 'above' ? ' ha subido a ' : ' ha bajado a ') + moneySmart(coin.price));
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
    if (store.rules.length >= 200) return res.status(400).json({ error: 'Máximo 200 alertas' });
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

app.post('/api/alerts/:id/test', async (req, res) => {
  const store = getAlertStore();
  const rule = store.rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: 'No existe esa alerta' });
  try {
    const portfolio = await refreshPortfolio(false);
    const coin = portfolio && Array.isArray(portfolio.coins) ? portfolio.coins.find(c => c.symbol === rule.symbol) : null;
    if (!coin) return res.status(404).json({ error: 'Esa moneda no está en la cartera' });
    await notifyUser(alertMessage(rule, coin), 'Quanto · ' + rule.symbol + (rule.op === 'above' ? ' ha subido a ' : ' ha bajado a ') + moneySmart(coin.price));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
  // Un campo vacío no borra el token guardado (solo se borra con clear: true).
  let token = String(b.token !== undefined ? b.token : '').trim();
  if (!token && !b.clear) token = (s.telegram && s.telegram.token) || '';
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

// ---------------- apariencia: fondo de pantalla y foto de perfil ----------------
const APPEARANCE_KINDS = ['wallpaper', 'avatar'];

function appearancePaths(kind) {
  const base = path.join(tenant.ctx().files.dir, kind === 'avatar' ? 'avatar' : 'wallpaper');
  return ['.jpg', '.png', '.webp'].map(ext => base + ext);
}

function findAppearance(kind) {
  for (const p of appearancePaths(kind)) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function saveAppearance(kind, dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Formato no válido: usa JPG, PNG o WebP');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!buf.length) throw new Error('La imagen está vacía');
  const max = kind === 'avatar' ? 2 * 1024 * 1024 : 8 * 1024 * 1024;
  if (buf.length > max) throw new Error('Imagen demasiado grande (máx. ' + Math.round(max / 1024 / 1024) + ' MB)');
  for (const p of appearancePaths(kind)) { try { fs.unlinkSync(p); } catch {} }
  fs.writeFileSync(path.join(DATA_DIR, kind + '.' + ext), buf);
}

app.get('/api/appearance', (req, res) => {
  const s = getSettings();
  const a = (s && s.appearance) || {};
  res.json({
    ok: true,
    wallpaper: !!findAppearance('wallpaper'),
    avatar: !!findAppearance('avatar'),
    ts: {
      wallpaper: (a.wallpaper && a.wallpaper.ts) || 0,
      avatar: (a.avatar && a.avatar.ts) || 0,
    },
  });
});

app.post('/api/appearance/:kind', (req, res) => {
  const kind = req.params.kind === 'avatar' ? 'avatar' : 'wallpaper';
  try {
    saveAppearance(kind, req.body && req.body.data);
    const s = getSettings();
    s.appearance = s.appearance || {};
    s.appearance[kind] = { ts: Date.now() };
    saveSettings(s);
    res.json({ ok: true, kind, ts: s.appearance[kind].ts });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/appearance/:kind', (req, res) => {
  const kind = req.params.kind === 'avatar' ? 'avatar' : 'wallpaper';
  for (const p of appearancePaths(kind)) { try { fs.unlinkSync(p); } catch {} }
  const s = getSettings();
  if (s.appearance) delete s.appearance[kind];
  saveSettings(s);
  res.json({ ok: true });
});

for (const kind of APPEARANCE_KINDS) {
  app.get('/api/' + kind, (req, res) => {
    const file = findAppearance(kind);
    if (!file) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(file);
  });
}

// Público (sin sesión): solo la foto de perfil, para mostrarla en la pantalla de acceso.

app.get('/appearance-public', (req, res) => {
  // La apariencia es por usuario: el login ya no muestra foto de nadie.
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ avatar: false, ts: 0 });
});


// ---------------- ajustes ----------------
app.get('/api/settings', (req, res) => {
  const s = getSettings();
  const me = currentUser();
  res.json({
    theme: s.theme || 'dark',
    hasPassword: !!(me && me.hash),
    apiKeyMasked: s.apiKey ? s.apiKey.slice(0, 4) + '••••••' + s.apiKey.slice(-4) : null,
    apiKeySet: !!s.apiKey,
    keysCleared: !!s.keysCleared,
    mode: effectiveMode(),
    version: VERSION,
    weekly: (s.weekly && { enabled: !!s.weekly.enabled }) || { enabled: false },
    fredKeySet: !!(s.fredKey && s.fredKey.length === 32),
    mailReady: mailer.ready(),
    telegramReady: !!telegramConfig().token,
    navOrder: Array.isArray(s.navOrder) ? s.navOrder : null,
  });
});


// ---------------- orden de las pestañas del menú ----------------
const NAV_VIEWS = new Set(['dashboard', 'coins', 'market', 'operations', 'tax', 'alerts', 'plans', 'trade', 'sim', 'news']);

app.post('/api/nav-order', (req, res) => {
  const body = req.body || {};
  const entrada = Array.isArray(body.order) ? body.order : [];
  const limpio = entrada
    .map(v => String(v || '').trim())
    .filter(v => NAV_VIEWS.has(v))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 20);
  if (!limpio.length) return res.status(400).json({ error: 'Orden no válido' });
  const s = getSettings();
  s.navOrder = limpio;
  saveSettings(s);
  res.json({ ok: true, navOrder: limpio });
});

app.post('/api/settings', (req, res) => {
  const body = req.body || {};
  const s = getSettings();

  if (body.password !== undefined) {
    return res.status(400).json({ error: 'La contraseña se cambia desde Ajustes → Seguridad (endpoint /api/password)' });
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
// Las rutas se resuelven en cada acceso: si no, se leen las del usuario base.
function backupFiles() {
  const f = tenant.ctx().files;
  return {
    ops: f.ops, history: f.history, holdings: f.holdings, overrides: f.overrides,
    settings: f.settings, alerts: f.alerts, plans: f.plans,
  };
}

function backupPayload() {
  const out = { app: 'quanto', version: VERSION, exportedAt: new Date().toISOString(), files: {} };
  for (const [key, file] of Object.entries(backupFiles())) out.files[key] = readJson(file, null);
  out.files.regimeWatch = getRegimeWatchStore();
  return out;
}

function applyBackupFiles(files) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const restored = [];
  const vacios = { ops: [], history: [], holdings: {}, overrides: {}, settings: {}, alerts: { rules: [] }, plans: { plans: [] } };
  for (const [key, file] of Object.entries(backupFiles())) {
    // Si la clave no está en la copia, no se toca. Si está pero vacía, se restaura vacía:
    // una copia debe devolver el estado exacto que tenía, no solo sobrescribir lo que trae.
    if (!Object.prototype.hasOwnProperty.call(files, key)) continue;
    const value = files[key] === null ? (vacios[key] || {}) : files[key];
    try { if (exists(file)) fs.copyFileSync(file, file + '.bak-' + stamp); } catch {}
    writeJson(file, value);
    restored.push(path.basename(file));
  }
  if (files.regimeWatch && typeof files.regimeWatch === 'object') {
    saveRegimeWatchStore(files.regimeWatch);
  }
  return restored;
}

app.get('/api/backup', limitHeavy, (req, res) => {
  const out = backupPayload();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quanto-copia-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(out, null, 1));
});

app.post('/api/restore', limitHeavy, (req, res) => {
  const backup = (req.body || {}).backup;
  const files = backup && backup.files;
  if (!files || typeof files !== 'object') return res.status(400).json({ error: 'Ese archivo no es una copia de Quanto.' });
  const restored = applyBackupFiles(files);
  if (!restored.length) return res.status(400).json({ error: 'La copia no contiene datos que restaurar.' });
  loadOps();
  state.portfolioAt = 0;
  state.evolutionCache = { at: 0, day: '', data: null };
  res.json({ ok: true, restored });
});

// ---- copias automáticas en el servidor ----
const backupsDir = () => path.join(tenant.ctx().files.dir, 'backups');

function backupCfg() {
  const b = (getSettings() || {}).backups || {};
  return {
    auto: b.auto !== false,
    keep: isFinite(Number(b.keep)) ? Math.min(60, Math.max(3, Math.round(Number(b.keep)))) : 14,
  };
}

function listBackupNames() {
  try { return fs.readdirSync(backupsDir()).filter(backupUtil.isValidName); } catch { return []; }
}

function createBackup(kind = 'auto') {
  const dir = backupsDir();
  ensureDir(dir);
  const name = backupUtil.backupName();
  writeJson(path.join(dir, name), backupPayload());
  const keep = backupCfg().keep;
  for (const old of backupUtil.planPrune(listBackupNames(), keep)) {
    try { fs.unlinkSync(path.join(dir, old)); } catch {}
  }
  let size = 0;
  try { size = fs.statSync(path.join(dir, name)).size; } catch {}
  console.log(`[copias] ${kind}: ${name} (${Math.round(size / 1024)} kB, quedan ${keep})`);
  return { file: name, at: backupUtil.parseName(name), size, kind };
}

function ensureAutoBackup() {
  if (!backupCfg().auto) return { skipped: 'desactivado' };
  if (!backupUtil.isDue(listBackupNames())) return { skipped: 'reciente' };
  return createBackup('auto');
}

app.get('/api/backups', (req, res) => {
  const dir = backupsDir();
  const items = backupUtil.sortNames(listBackupNames()).reverse().map(name => {
    let size = 0;
    try { size = fs.statSync(path.join(dir, name)).size; } catch {}
    return { file: name, at: backupUtil.parseName(name), size };
  });
  res.json({ ok: true, cfg: backupCfg(), items });
});

app.post('/api/backups', (req, res) => {
  try {
    const out = createBackup('manual');
    res.json({ ok: true, ...out, cfg: backupCfg() });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo crear la copia: ' + e.message });
  }
});

app.post('/api/backups/restore', (req, res) => {
  const name = String((req.body || {}).file || '');
  if (!backupUtil.isValidName(name)) return res.status(400).json({ error: 'Copia no válida.' });
  const data = readJson(path.join(backupsDir(), name), null);
  if (!data || !data.files) return res.status(400).json({ error: 'La copia está vacía o dañada.' });
  const restored = applyBackupFiles(data.files);
  if (!restored.length) return res.status(400).json({ error: 'La copia no contiene datos.' });
  loadOps();
  state.portfolioAt = 0;
  state.evolutionCache = { at: 0, day: '', data: null };
  console.log(`[copias] restaurada ${name}: ${restored.join(', ')}`);
  res.json({ ok: true, restored, file: name });
});

app.post('/api/backups/config', (req, res) => {
  const s = getSettings();
  const b = req.body || {};
  const actual = backupCfg();
  s.backups = {
    auto: b.auto != null ? b.auto === true : actual.auto,
    keep: isFinite(Number(b.keep)) ? Math.min(60, Math.max(3, Math.round(Number(b.keep)))) : actual.keep,
  };
  saveSettings(s);
  res.json({ ok: true, cfg: backupCfg() });
});

// ---------------- informe semanal de coherencia ----------------
function coherenceCfg() {
  const c = (getSettings() || {}).coherence || {};
  return {
    enabled: c.enabled !== false,
    weekday: 1,                     // lunes
    hour: isFinite(Number(c.hour)) ? Math.min(23, Math.max(0, Math.round(Number(c.hour)))) : 9,
    lastSentAt: Number(c.lastSentAt) || 0,
  };
}

async function buildCoherenceData() {
  const p = state.portfolio;
  if (!p || !Array.isArray(p.coins) || !p.coins.length) return { ok: false, error: 'Sin cartera.' };
  const coins = p.coins.filter(c => Number(c.value) > 0).slice(0, 6);
  const regimes = [];
  const rets = {};
  for (const c of coins) {
    try {
      const rows = await riskRoutes.dailyCandles(c.symbol, 400);
      const r = detectRegime(rows);
      if (r.ok) regimes.push({ symbol: c.symbol, ...r });
      const closes = rows.map(x => Number(x[4]));
      const rr = [];
      for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] > 0 && closes[i] > 0) rr.push(Math.log(closes[i] / closes[i - 1]));
      }
      rets[c.symbol] = rr;
    } catch { /* esa moneda se queda fuera */ }
  }
  const positions = coins.map(c => ({ symbol: c.symbol, value: Number(c.value) }));
  const sizing = sizePortfolio(positions, rets, { maxWeight: 0.35, minWeight: 0.05, alignDays: 120 });
  let twr = null;
  try {
    const evo = await buildEvolution();
    let btc = [];
    try {
      const raw = await client.candles('BTC-EUR', '1d', 1000);
      btc = (Array.isArray(raw) ? raw : [])
        .map(c => ({ t: Number(c[0]), close: parseFloat(c[4]) }))
        .filter(x => isFinite(x.close))
        .sort((a, b) => a.t - b.t);
    } catch { /* sin benchmark */ }
    twr = computeTwr({ points: evo.points || [], ops: opsForView(), btc, days: 30 });
  } catch { /* sin TWR */ }
  return { ok: true, regimes, sizing, twr, total: p.totalValue };
}

async function sendCoherence(kind = 'manual') {
  const data = await buildCoherenceData();
  if (!data.ok) return { ok: false, error: data.error };
  const report = coherence.build({ ...data, now: Date.now() });
  const results = await notifyUser(report.text, report.subject, report.html);
  const settings = getSettings();
  settings.coherence = {
    ...(settings.coherence || {}),
    enabled: coherenceCfg().enabled,
    lastSentAt: Date.now(),
    lastKind: kind,
  };
  saveSettings(settings);
  console.log(`[coherencia] informe ${kind} enviado (${results.telegram === 'ok' ? 'telegram' : 'sin telegram'}/${results.email === 'ok' ? 'email' : 'sin email'})`);
  return { ok: true, results, report };
}

app.get('/api/coherence', async (req, res) => {
  const cfg = coherenceCfg();
  if (req.query.preview === '1') {
    try {
      const data = await buildCoherenceData();
      if (!data.ok) return res.json({ ok: false, error: data.error, cfg });
      const report = coherence.build({ ...data, now: Date.now() });
      return res.json({ ok: true, cfg, preview: { text: report.text, subject: report.subject } });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message, cfg });
    }
  }
  res.json({ ok: true, cfg, channels: notifyChannels() });
});

app.post('/api/coherence/send', async (req, res) => {
  try {
    const out = await sendCoherence('manual');
    if (!out.ok) return res.status(400).json({ error: out.error });
    res.json({ ok: true, results: out.results, cfg: coherenceCfg() });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo enviar: ' + e.message });
  }
});

app.post('/api/coherence/config', (req, res) => {
  const s = getSettings();
  const b = req.body || {};
  s.coherence = {
    ...(s.coherence || {}),
    enabled: b.enabled != null ? b.enabled === true : coherenceCfg().enabled,
    hour: isFinite(Number(b.hour)) ? Math.min(23, Math.max(0, Math.round(Number(b.hour)))) : coherenceCfg().hour,
  };
  saveSettings(s);
  res.json({ ok: true, cfg: coherenceCfg() });
});

async function maybeSendWeeklyCoherence() {
  const cfg = coherenceCfg();
  if (!cfg.enabled) return;
  const now = new Date();
  if (now.getDay() !== cfg.weekday || now.getHours() < cfg.hour) return;
  if (Date.now() - cfg.lastSentAt < 6 * 86400e3) return;
  try { await sendCoherence('auto'); } catch (e) { console.log('[coherencia] fallo:', e.message); }
}

setInterval(() => { tenant.forEachUser(() => maybeSendWeeklyCoherence().catch(() => {})); }, 3600e3);
setTimeout(() => { tenant.forEachUser(() => maybeSendWeeklyCoherence().catch(() => {})); }, 5 * 60e3);

// una copia al día; se revisa cada hora y al arrancar
setInterval(() => { tenant.forEachUser(() => { try { ensureAutoBackup(); } catch {} }); }, 3600e3);
setTimeout(() => { tenant.forEachUser(() => { try { ensureAutoBackup(); } catch {} }); }, 90e3);

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

app.get('/api/export/transactions.xlsx', limitHeavy, async (req, res) => {
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

app.get('/api/export/tax.xlsx', limitHeavy, async (req, res) => {
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
// ---------------- liquidez y noticias ----------------
let liqCache = { at: 0, data: null };
const LIQ_TTL = 6 * 3600e3;

app.get('/api/liquidity', async (req, res) => {
  if (liqCache.data && Date.now() - liqCache.at < LIQ_TTL) {
    return res.json({ ok: true, ...liqCache.data, cached: true });
  }
  try {
    const data = await getLiquidity();
    liqCache = { at: Date.now(), data };
    res.json({ ok: true, ...data, cached: false });
  } catch (e) {
    if (liqCache.data) return res.json({ ok: true, ...liqCache.data, cached: true, stale: true });
    res.status(502).json({ error: 'No se pudo obtener la liquidez: ' + e.message });
  }
});

let calCache = { at: 0, key: '', data: null };
const CAL_TTL = 6 * 3600e3;

app.get('/api/calendar', async (req, res) => {
  const key = String((getSettings().fredKey || '')).trim();
  if (!key) return res.json({ ok: true, configured: false, items: [] });
  const sig = key.slice(-6);
  if (calCache.data && calCache.key === sig && Date.now() - calCache.at < CAL_TTL) {
    return res.json({ ok: true, ...calCache.data, cached: true });
  }
  try {
    const data = await getCalendar(key);
    calCache = { at: Date.now(), key: sig, data };
    res.json({ ok: true, ...data, cached: false });
  } catch (e) {
    if (calCache.data && calCache.key === sig) return res.json({ ok: true, ...calCache.data, cached: true, stale: true });
    res.status(502).json({ error: 'No se pudo leer el calendario: ' + e.message });
  }
});

app.post('/api/calendar/key', (req, res) => {
  const key = String((req.body || {}).key || '').trim();
  const s = getSettings();
  if (key && !/^[a-f0-9]{32}$/i.test(key)) return res.status(400).json({ error: 'La clave de FRED son 32 caracteres hexagonales' });
  s.fredKey = key;
  saveSettings(s);
  calCache = { at: 0, key: '', data: null };
  res.json({ ok: true, configured: !!key });
});

let pulseCache = { at: 0, data: null };
const PULSE_TTL = 10 * 60e3;

app.get('/api/pulse', async (req, res) => {
  if (pulseCache.data && Date.now() - pulseCache.at < PULSE_TTL) {
    return res.json({ ok: true, ...pulseCache.data, cached: true });
  }
  try {
    const data = await getPulse();
    pulseCache = { at: Date.now(), data };
    res.json({ ok: true, ...data, cached: false });
  } catch (e) {
    if (pulseCache.data) return res.json({ ok: true, ...pulseCache.data, cached: true, stale: true });
    res.status(502).json({ error: 'No se pudo leer el pulso: ' + e.message });
  }
});

// ---------------- rangos de precio (ATH/ATL y año en curso) ----------------
const RANGE_FILE = path.join(DATA_DIR, 'cache', 'ranges.json');
const RANGE_TTL = 6 * 3600e3;      // año en curso
const ATH_TTL = 24 * 3600e3;       // ATH/ATL (CoinGecko limita mucho)

function loadRangeCache() {
  const raw = readJson(RANGE_FILE, null);
  if (raw && typeof raw === 'object' && raw.data) return raw;
  return { at: 0, data: {} };
}
let rangeCache = loadRangeCache();
function saveRangeCache() {
  try { writeJson(RANGE_FILE, rangeCache); } catch (e) { console.log('[rangos] guardar:', e.message); }
}

let rangeQueue = [];
let rangeBusy = false;
function rangeDrain() {
  if (rangeBusy || !rangeQueue.length) return;
  rangeBusy = true;
  const sym = rangeQueue.shift();
  (async () => {
    try {
      const now = Date.now();
      const eur = rangeCache.eurRate;
      let v = null;
      // 1º CoinGecko (histórico completo y exacto)
      try {
        const ids = await ranges.symbolIds([sym]);
        if (ids[sym]) {
          const data = await ranges.athAtl({ [sym]: ids[sym] });
          const cg = data[sym];
          if (cg) v = { ...cg, ath: eur && cg.ath ? cg.ath * eur : null, atl: eur && cg.atl ? cg.atl * eur : null, src: 'coingecko' };
        }
      } catch (e) { v = null; }
      // 2º Binance si CoinGecko no responde (aproximado: desde su salida en Binance)
      if (!v) {
        try { const b = await ranges.binanceRange(sym, eur); if (b) v = { ...b, src: 'binance' }; } catch (e) { v = null; }
      }
      if (v) {
        rangeCache.data[sym] = { ...(rangeCache.data[sym] || {}), ...v, athAt: now };
        // Solo CoinGecko da el histórico completo; el resto se marca como aproximado
        const exacto = v.src === 'coingecko';
        if (v.ath) rangeCache.data[sym].athApprox = !exacto;
        if (v.atl) rangeCache.data[sym].atlApprox = !exacto;
        saveRangeCache();
        console.log('[rangos] ATH de', sym, 'listo');
      }
    } catch (e) { console.log('[rangos]', sym, e.message); }
    rangeBusy = false;
    setTimeout(rangeDrain, 20000);
  })();
}

app.get('/api/ranges', async (req, res) => {
  const symbols = String(req.query.symbols || '')
    .toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
  if (!symbols.length) return res.status(400).json({ error: 'Faltan monedas' });

  const now = Date.now();
  const out = { ...rangeCache.data };

  // 1) máximo y mínimo del año (velas de Bitvavo; barato y fiable)
  for (const sym of symbols) {
    const entry = out[sym] || {};
    if (entry.yearAt && now - entry.yearAt < RANGE_TTL) continue;
    try {
      const raw = await client.candles(`${sym}-EUR`, '1d', 1000);
      const rows = (Array.isArray(raw) ? raw : [])
        .map(k => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])])
        .filter(r => r.every(n => isFinite(n)))
        .reverse();
      const yr = ranges.yearRange(rows);
      const hist = rows.length
        ? {
            histHigh: Math.max(...rows.map(r => Number(r[2]))),
            histLow: Math.min(...rows.map(r => Number(r[3]))),
            histFrom: Number(rows[0][0]) || null,
          }
        : {};
      if (yr) out[sym] = { ...entry, ...yr, ...hist, yearAt: now };
    } catch { /* sin par en EUR */ }
  }

  // 2) ATH/ATL: como máximo una moneda por petición y cacheado 24 h
  let eurRate = rangeCache.eurRate && now - (rangeCache.eurAt || 0) < ATH_TTL ? rangeCache.eurRate : null;
  if (!eurRate) {
    try {
      const usdc = await client.tickerPrice('USDC-EUR');
      const px = Number(usdc && (usdc.price || (Array.isArray(usdc) && usdc[0] && usdc[0].price)));
      if (px > 0) { eurRate = px; rangeCache.eurRate = px; rangeCache.eurAt = now; }
    } catch {}
  }

  // Los valores aproximados (Binance o histórico corto) se reintentan antes
  const pendiente = symbols.filter(s => {
    const e = out[s];
    if (!e || !e.athAt) return true;
    const ttl = e.athApprox ? 6 * 3600e3 : ATH_TTL;
    return now - e.athAt > ttl;
  });
  for (const s of pendiente) if (!rangeQueue.includes(s)) rangeQueue.push(s);
  rangeDrain();

  // Relleno con el histórico de Bitvavo cuando no hay ATH/ATL exactos
  for (const sym of symbols) {
    const e = out[sym];
    if (!e) continue;
    if (!e.ath && e.histHigh) { e.ath = e.histHigh; e.athApprox = true; e.athFrom = e.histFrom || null; }
    if (!e.atl && e.histLow) { e.atl = e.histLow; e.atlApprox = true; e.atlFrom = e.histFrom || null; }
  }

  rangeCache.data = out;
  rangeCache.at = now;
  saveRangeCache();
  res.json({ ok: true, ranges: out, eurRate, pendiente: pendiente.length, cached: false });
});

app.get('/api/analyze', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const interval = String(req.query.interval || '1h');
  const allowed = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d'];
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  if (!allowed.includes(interval)) return res.status(400).json({ error: 'Intervalo no válido' });
  try {
    const raw = await client.candles(`${symbol}-EUR`, interval, 300);
    const rows = (Array.isArray(raw) ? raw : [])
      .map(k => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])])
      .filter(r => r.every(n => isFinite(n)))
      .reverse();
    const out = analyzeMarket({
      rows,
      symbol,
      portfolio: state.portfolio,
      plans: (getPlanStore().plans || []),
      indicators: String(req.query.ind || ''),
    });
    res.json({ ok: true, ...out, interval, at: Date.now() });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo analizar: ' + e.message });
  }
});

// ---------------- liquidez y noticias ----------------
let levCache = { at: 0, data: null };
const LEV_TTL = 6 * 3600e3;

app.get('/api/leverage', async (req, res) => {
  if (levCache.data && Date.now() - levCache.at < LEV_TTL) {
    return res.json({ ok: true, ...levCache.data, cached: true });
  }
  try {
    const data = await getLeverage();
    levCache = { at: Date.now(), data };
    res.json({ ok: true, ...data, cached: false });
  } catch (e) {
    if (levCache.data) return res.json({ ok: true, ...levCache.data, cached: true, stale: true });
    res.status(502).json({ error: 'No se pudo calcular la deuda: ' + e.message });
  }
});

let newsCache = { at: 0, key: '', data: null };
const NEWS_TTL = 15 * 60e3;

// La traducción de titulares va en segundo plano: el número de pendientes se recalcula.
function newsPending(data) {
  const items = (data && data.items) || [];
  return items.filter(i => i.lang && i.lang !== 'es' && !i.translated).length;
}

app.get('/api/news', async (req, res) => {
  const coins = String(req.query.coins || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
  const key = coins.join(',');
  if (newsCache.data && newsCache.key === key && Date.now() - newsCache.at < NEWS_TTL) {
    return res.json({ ok: true, ...newsCache.data, pending: newsPending(newsCache.data), cached: true });
  }
  try {
    const data = await getNews({ coins, limit: 60 });
    newsCache = { at: Date.now(), key, data };
    res.json({ ok: true, ...data, pending: newsPending(data), cached: false });
  } catch (e) {
    if (newsCache.data) return res.json({ ok: true, ...newsCache.data, pending: newsPending(newsCache.data), cached: true, stale: true });
    res.status(502).json({ error: 'No se pudieron leer las noticias: ' + e.message });
  }
});

const registerRiskRoutes = require('./lib/routes/risk');
const riskRoutes = registerRiskRoutes(app, {
  client, state, tenant, path, readJson, writeJson,
  getSettings, saveSettings, notifyUser, notifyConfig, telegramConfig,
});
const { getRegimeWatchStore, saveRegimeWatchStore } = riskRoutes;

// Precalienta los titulares (y sus traducciones) para que el primer acceso sea rápido.
setTimeout(() => { getNews({ coins: [], limit: 60 }).catch(() => {}); }, 12e3).unref?.();

// ---------------- iconos de monedas (con caché en disco) ----------------
const ICON_DIR = path.join(DATA_DIR, 'icons');
ensureDir(ICON_DIR);
const iconMisses = new Set();

app.get('/api/icon/:symbol', limitHeavy, async (req, res) => {
  const sym = String(req.params.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!sym) return res.status(404).end();
  const file = path.join(ICON_DIR, sym.toLowerCase() + '.png');
  try {
    if (fs.existsSync(file)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.sendFile(file);
    }
  } catch {}
  const letraSvg = (s) => {
    const c = (s || '?').slice(0, 1);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b2230"/><text x="32" y="42" font-family="system-ui,Arial" font-size="30" font-weight="700" fill="#9fb0c9" text-anchor="middle">${c}</text></svg>`;
  };
  if (iconMisses.has(sym)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.type('svg').send(letraSvg(sym));
  }
  const sources = [
    `https://assets.coincap.io/assets/icons/${sym.toLowerCase()}@2x.png`,
    `https://bin.bnbstatic.com/static/assets/logos/${sym}.png`,
  ];
  for (const url of sources) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 400) continue;
      try { fs.writeFileSync(file, buf); } catch {}
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.type('png').send(buf);
      return;
    } catch {}
  }
  iconMisses.add(sym);
  if (iconMisses.size > 4000) iconMisses.clear();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('svg').send(letraSvg(sym));
});

// Si hay build de Vite (dist/) se sirve ese; si no, el public/ de siempre.
// Así el despliegue puede seguir siendo una copia directa sin build.
const WEB_DIR = exists(path.join(__dirname, 'dist', 'index.html')) ? path.join(__dirname, 'dist') : path.join(__dirname, 'public');
app.use(express.static(WEB_DIR, { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
// Compatibilidad con la ruta de la app anterior (/app.html) y con enlaces antiguos
app.get(['/app.html', '/app'], (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No existe' });
  res.status(404).send('No encontrado');
});

// ---------------- migración a multi-usuario ----------------
function migrateToUsers() {
  if (userStore.list().length) return;
  const hasLegacy = fs.existsSync(LEGACY_FILES.ops) || fs.existsSync(LEGACY_FILES.settings);
  if (!hasLegacy) return; // instalación nueva: el asistente crea la cuenta
  const legacySettings = readJson(LEGACY_FILES.settings, {}) || {};
  let hash = legacySettings.password && legacySettings.password.hash ? legacySettings.password : null;
  if (!hash && (process.env.APP_PASSWORD || '').trim()) hash = hashPassword(process.env.APP_PASSWORD.trim());

  const jorge = userStore.create({ username: 'jorge', role: 'user', passwordHash: hash, mustChange: false });
  const dir = userStore.userDir(jorge.id);
  for (const key of ['ops', 'history', 'holdings', 'overrides', 'settings', 'alerts', 'plans']) {
    const src = LEGACY_FILES[key];
    if (!src) continue;
    try {
      if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, path.basename(src)));
    } catch (e) { console.log('[migracion]', key, e.message); }
  }
  for (const kind of ['wallpaper', 'avatar']) {
    for (const ext of ['.jpg', '.png', '.webp']) {
      const src = path.join(DATA_DIR, kind + ext);
      try { if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, kind + ext)); } catch {}
    }
  }
  console.log('================================================');
  console.log(' Quanto multi-usuario: datos migrados');
  console.log('   Usuario de datos: jorge (conserva su contraseña)');
  console.log('   Abre la app para crear la cuenta de administrador');
  console.log('================================================');
}

// ---------------- arranque ----------------
migrateToUsers();
tenant.forEachUser(() => { applyKeys(); });

// Calienta los índices globales para que el informe semanal y la pestaña vayan listos.
setTimeout(() => {
  getLiquidity().then(d => { liqCache = { at: Date.now(), data: d }; }).catch(() => {});
  getLeverage().then(d => { levCache = { at: Date.now(), data: d }; }).catch(() => {});
  getPulse().then(d => { pulseCache = { at: Date.now(), data: d }; }).catch(() => {});
}, 8000);

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Quanto ${VERSION} en http://0.0.0.0:${PORT} · ${userStore.list().length} usuarios`);
  console.log(`Datos en ${DATA_DIR}`);
  try {
    tenant.forEachUser(async (u) => {
      if (client.configured) {
        const sync = await syncFromBitvavo({ force: true });
        if (!sync.ok) console.log('[sync] ' + u.username + ':', sync.error || sync.reason);
      }
      await refreshPortfolio(true);
      if (state.portfolio) {
        console.log(`[${u.username}] cartera: ${state.portfolio.totalValue} EUR · ${state.portfolio.coinCount} monedas`);
      }
    });
  } catch (e) {
    console.error('[arranque]', e.message);
  }
});

setInterval(() => { tenant.forEachUser(() => refreshPortfolio(true).catch(() => {})); }, SNAP_MS);

// Alertas automáticas por porcentaje: cada 5 minutos, sobre las monedas en cartera.
setInterval(() => {
  tenant.forEachUser(async (u) => {
    try { await checkAutoAlerts(u); } catch (e) { console.log('[auto] ' + u.username + ':', e.message); }
  });
}, 5 * 60e3);

// Cada 10 minutos trae las órdenes abiertas de Bitvavo a Planes.
setInterval(() => {
  tenant.forEachUser(async () => {
    if (!client.configured) return;
    try {
      const r = await syncBitvavoPlans();
      if (r && (r.tramosNuevos || r.tramosCerrados)) {
        console.log(`[planes] Bitvavo: ${r.tramosNuevos} tramos nuevos, ${r.tramosCerrados} cerrados`);
      }
    } catch (e) { console.log('[planes] sync:', e.message); }
  });
}, 10 * 60e3);

let syncTimer = 0;
setInterval(() => {
  if (Date.now() - syncTimer < 2 * 60e3) return;
  syncTimer = Date.now();
  tenant.forEachUser(() => {
    if (!client.configured) return;
    syncFromBitvavo().catch(() => {});
  });
}, 2 * 60e3);

// Alertas de precio: se revisan cada minuto (Telegram).
setInterval(() => { tenant.forEachUser(() => runAlertCheck().catch(() => {})); }, ALERT_CHECK_MS);

process.on('unhandledRejection', (err) => console.error('[unhandled]', err && err.message ? err.message : err));
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
