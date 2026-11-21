'use strict';
// Rutas de riesgo: régimen, tamaño de posiciones, reality check y vigilante.
// Se registran con las dependencias del servidor para no depender del estado global.
const { detectRegime } = require('../regime');
const { sizePortfolio } = require('../sizing');
const { realityCheck, STRATEGIES } = require('../reality');
const regimeWatch = require('../regime-watch');

module.exports = function registerRiskRoutes(app, deps) {
  const {
    client, state, tenant, path, readJson, writeJson,
    getSettings, saveSettings, notifyUser, notifyConfig, telegramConfig,
  } = deps;

const regimeCache = new Map();
const CACHE_10M = 10 * 60e3;

function cacheGet(map, key, ttl = CACHE_10M) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) { map.delete(key); return null; }
  return hit.data;
}
function cacheSet(map, key, data) {
  map.set(key, { at: Date.now(), data });
  if (map.size > 200) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

async function dailyCandles(symbol, limit) {
  const raw = await client.candles(`${symbol}-EUR`, '1d', limit);
  return (Array.isArray(raw) ? raw : [])
    .map(k => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])])
    .filter(r => r.every(n => isFinite(n)))
    .reverse();
}

app.get('/api/regime', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  const limit = Math.min(1000, Math.max(120, Number(req.query.days) || 400));
  const key = `${symbol}:${limit}`;
  const cached = cacheGet(regimeCache, key);
  if (cached) return res.json({ ok: true, symbol, at: Date.now(), cached: true, ...cached });
  try {
    const rows = await dailyCandles(symbol, limit);
    const out = detectRegime(rows);
    if (!out.ok) return res.status(400).json({ error: out.error });
    cacheSet(regimeCache, key, out);
    res.json({ ok: true, symbol, at: Date.now(), cached: false, ...out });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo leer el régimen: ' + e.message });
  }
});

app.get('/api/sizing', async (req, res) => {
  const portfolio = state.portfolio;
  if (!portfolio || !Array.isArray(portfolio.coins) || !portfolio.coins.length) {
    return res.status(400).json({ error: 'Sin cartera: conecta Bitvavo o importa el histórico.' });
  }
  const maxWeight = Math.min(0.8, Math.max(0.1, (Number(req.query.max) || 35) / 100));
  const days = Math.min(365, Math.max(60, Number(req.query.days) || 120));
  const coins = portfolio.coins.filter(c => Number(c.value) > 0).slice(0, 8);
  const positions = coins.map(c => ({ symbol: c.symbol, value: Number(c.value), name: c.symbol }));
  const returns = {};
  const failed = [];
  const results = await Promise.allSettled(coins.map(c => dailyCandles(c.symbol, Math.min(365, days + 40))));
  results.forEach((r, i) => {
    const sym = coins[i].symbol;
    if (r.status !== 'fulfilled' || r.value.length < 40) { failed.push(sym); return; }
    const closes = r.value.map(row => row[4]);
    const rets = [];
    for (let k = 1; k < closes.length; k++) if (closes[k - 1] > 0 && closes[k] > 0) rets.push(Math.log(closes[k] / closes[k - 1]));
    returns[sym] = rets;
  });
  const minWeight = Math.min(0.2, Math.max(0, (Number(req.query.min) || 5) / 100));
  const out = sizePortfolio(positions, returns, { maxWeight, minWeight, alignDays: days });
  if (!out.ok) return res.status(400).json({ error: out.error, failed });
  res.json({
    ok: true, at: Date.now(),
    ...out,
    failed,
    total: portfolio.totalValue,
  });
});

app.get('/api/reality', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbol) return res.status(400).json({ error: 'Falta la moneda' });
  const cost = Math.min(100, Math.max(0, Number(req.query.cost) || 5));
  const limit = Math.min(1000, Math.max(400, Number(req.query.days) || 1000));
  const key = `${symbol}:${limit}:${cost}`;
  const cached = cacheGet(regimeCache, 'r:' + key);
  if (cached) return res.json({ ok: true, symbol, at: Date.now(), cached: true, ...cached });
  try {
    const rows = await dailyCandles(symbol, limit);
    const out = realityCheck(rows, { costBps: cost });
    if (!out.ok) return res.status(400).json({ error: out.error });
    cacheSet(regimeCache, 'r:' + key, out);
    res.json({ ok: true, symbol, at: Date.now(), cached: false, strategies: STRATEGIES, ...out });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo evaluar: ' + e.message });
  }
});

// ---------------- vigilante de régimen (avisos proactivos) ----------------
const regimeWatchFile = () => path.join(tenant.ctx().files.dir, 'regime-watch.json');

function getRegimeWatchStore() {
  const raw = readJson(regimeWatchFile(), null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { at: 0, items: {} };
  if (!raw.items || typeof raw.items !== 'object') raw.items = {};
  return raw;
}
function saveRegimeWatchStore(v) { writeJson(regimeWatchFile(), v); }

const REGIME_WATCH_DEFAULTS = { enabled: false, intervalH: 6, cooldownH: 12 };
function regimeWatchCfg() {
  const c = (getSettings() || {}).regimeWatch || {};
  const num = (v, def, lo, hi) => (isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def);
  return {
    enabled: c.enabled === true,
    intervalH: num(c.intervalH, REGIME_WATCH_DEFAULTS.intervalH, 1, 72),
    cooldownH: num(c.cooldownH, REGIME_WATCH_DEFAULTS.cooldownH, 1, 168),
  };
}

let regimeWatchBusy = false;

async function runRegimeWatch({ force = false } = {}) {
  const cfg = regimeWatchCfg();
  const store = getRegimeWatchStore();
  if (!cfg.enabled && !force) return { skipped: 'desactivado' };
  if (!force && !regimeWatch.due(store, cfg.intervalH)) return { skipped: 'no toca todavía' };
  if (regimeWatchBusy) return { skipped: 'ocupado' };
  const p = state.portfolio;
  if (!p || !Array.isArray(p.coins) || !p.coins.length) return { skipped: 'sin cartera' };
  regimeWatchBusy = true;
  const fired = [];
  const errors = [];
  try {
    const coins = p.coins.filter(c => Number(c.value) > 0).slice(0, 6);
    for (const coin of coins) {
      try {
        const rows = await dailyCandles(coin.symbol, 400);
        const regime = detectRegime(rows);
        if (!regime.ok) continue;
        const next = regimeWatch.summarize(regime);
        const prev = store.items[coin.symbol] || null;
        const { changed, reasons } = regimeWatch.diff(prev, next);
        const cooled = regimeWatch.cooled(store.items[coin.symbol], cfg.cooldownH);
        const soloInicial = reasons.length > 0 && reasons.every(r => r.kind === 'inicial');
        if (changed && !soloInicial && (cooled || force)) {
          const text = regimeWatch.message(coin.symbol, prev, next, reasons);
          await notifyUser(text, regimeWatch.subject(coin.symbol, reasons));
          next.sentAt = Date.now();
          store.items[coin.symbol] = next;
          fired.push({ symbol: coin.symbol, reasons });
        } else if (!changed || soloInicial) {
          store.items[coin.symbol] = next;
        }
      } catch (e) {
        errors.push(coin.symbol + ': ' + e.message);
      }
    }
    store.at = Date.now();
    saveRegimeWatchStore(store);
    if (fired.length) console.log('[régimen] avisos:', fired.map(f => f.symbol).join(', '));
    return { checked: coins.length, fired, errors };
  } finally {
    regimeWatchBusy = false;
  }
}

function notifyChannels() {
  const cfg = notifyConfig();
  const tg = telegramConfig();
  return { telegram: !!(tg.token && tg.chatId), email: !!(cfg.emailEnabled && cfg.email) };
}

app.get('/api/regime-watch', (req, res) => {
  const store = getRegimeWatchStore();
  res.json({ ok: true, cfg: regimeWatchCfg(), at: store.at || 0, items: store.items, channels: notifyChannels() });
});

app.post('/api/regime-watch', async (req, res) => {
  const b = req.body || {};
  const settings = getSettings();
  const actual = regimeWatchCfg();
  if (b.test === true) {
    const results = await notifyUser(
      '🔔 Prueba del vigilante de régimen.\nSi ves este mensaje, los avisos llegarán cuando una moneda cambie de tendencia o de volatilidad.',
      'Quanto · prueba del vigilante',
    );
    return res.json({ ok: true, test: true, results });
  }
  settings.regimeWatch = {
    enabled: b.enabled != null ? b.enabled === true : actual.enabled,
    intervalH: isFinite(b.intervalH) ? Math.min(72, Math.max(1, Math.round(Number(b.intervalH)))) : actual.intervalH,
    cooldownH: isFinite(b.cooldownH) ? Math.min(168, Math.max(1, Math.round(Number(b.cooldownH)))) : actual.cooldownH,
  };
  saveSettings(settings);
  const cfg = regimeWatchCfg();
  if (cfg.enabled && b.force !== false) {
    runRegimeWatch({ force: false }).catch(() => {});
  }
  res.json({ ok: true, cfg, channels: notifyChannels() });
});

// cada 30 minutos se comprueba si toca revisar (el intervalo real manda)
setInterval(() => { tenant.forEachUser(() => runRegimeWatch().catch(() => {})); }, 30 * 60e3);
setTimeout(() => { tenant.forEachUser(() => runRegimeWatch().catch(() => {})); }, 4 * 60e3);

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

  return { getRegimeWatchStore, saveRegimeWatchStore, runRegimeWatch, dailyCandles };
};
