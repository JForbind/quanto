'use strict';
// Rangos de precio: máximo/mínimo del año (velas de Bitvavo) y ATH/ATL (CoinGecko).
const CG = 'https://api.coingecko.com/api/v3';

async function fetchJson(url, ms = 9000, intentos = 3) {
  let last;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Quanto/1.0' } });
      if (r.status === 429) { await new Promise(r2 => setTimeout(r2, 2500 * (i + 1))); last = new Error('HTTP 429'); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    } catch (e) {
      last = e;
      if (i < intentos - 1) await new Promise(r2 => setTimeout(r2, 1200 * (i + 1)));
    }
  }
  throw last;
}

/** id de CoinGecko para cada símbolo, usando el top 250 por capitalización. */
async function symbolIds(symbols) {
  const markets = await fetchJson(`${CG}/coins/markets?vs_currency=usd&per_page=250&page=1`);
  const map = {};
  for (const c of Array.isArray(markets) ? markets : []) {
    const sym = String(c.symbol || '').toUpperCase();
    if (!sym || map[sym]) continue;
    if (!symbols || symbols.includes(sym)) map[sym] = c.id;
  }
  return map;
}

/** Cambio USD→EUR actual (vía USDT), para pasar ATH/ATL a euros. */
async function usdToEur() {
  try {
    const d = await fetchJson(`${CG}/simple/price?ids=tether&vs_currencies=eur`);
    const v = d && d.tether && d.tether.eur;
    return Number(v) > 0 ? Number(v) : null;
  } catch {
    return null;
  }
}

async function athAtl(ids) {
  const out = {};
  const entries = Object.entries(ids);
  for (const [sym, id] of entries) {
    try {
      const d = await fetchJson(`${CG}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`);
      const m = d && d.market_data;
      if (!m) continue;
      out[sym] = {
        ath: Number(m.ath && m.ath.usd) || null,
        athDate: m.ath_date && m.ath_date.usd ? Date.parse(m.ath_date.usd) : null,
        atl: Number(m.atl && m.atl.usd) || null,
        atlDate: m.atl_date && m.atl_date.usd ? Date.parse(m.atl_date.usd) : null,
      };
      await new Promise(r => setTimeout(r, 600)); // no saturar la API gratuita
    } catch { /* seguimos con el resto */ }
  }
  return out;
}

/** Máximo y mínimo del año en curso a partir de velas diarias. */
function yearRange(rows) {
  const year = new Date().getFullYear();
  const from = new Date(year, 0, 1).getTime();
  const slice = rows.filter(r => Number(r[0]) >= from);
  if (!slice.length) return null;
  return {
    year,
    high: Math.max(...slice.map(r => Number(r[2]))),
    low: Math.min(...slice.map(r => Number(r[3]))),
    candles: slice.length,
  };
}


/** ATH/ATL desde Binance con velas semanales (hasta ~19 años de histórico). */
async function binanceRange(symbol, eurRate) {
  const pair = String(symbol).toUpperCase() + 'USDT';
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1w&limit=1000`;
  const rows = await fetchJson(url, 9000, 2);
  if (!Array.isArray(rows) || !rows.length) return null;
  let hi = null, hiAt = null, lo = null, loAt = null;
  for (const r of rows) {
    const t0 = Number(r[0]);
    const high = Number(r[2]);
    const low = Number(r[3]);
    if (!isFinite(high) || !isFinite(low)) continue;
    if (hi === null || high > hi) { hi = high; hiAt = t0; }
    if (lo === null || low < lo) { lo = low; loAt = t0; }
  }
  if (hi === null) return null;
  return {
    athUsd: hi, athDate: hiAt, atlUsd: lo, atlDate: loAt,
    ath: eurRate ? hi * eurRate : null,
    atl: eurRate ? lo * eurRate : null,
  };
}

module.exports = { symbolIds, athAtl, usdToEur, yearRange, binanceRange };
