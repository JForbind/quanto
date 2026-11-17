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

/** id de CoinGecko de un símbolo (busca en TODO el catálogo, no solo el top 250). */
async function symbolId(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return null;
  const d = await fetchJson(`${CG}/search?query=${encodeURIComponent(sym)}`);
  const coins = (d && Array.isArray(d.coins)) ? d.coins : [];
  const exactos = coins.filter(c => String(c.symbol || '').toUpperCase() === sym);
  if (!exactos.length) return null;
  // si hay varios con el mismo símbolo, el de mayor capitalización (menor puesto)
  exactos.sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9));
  return exactos[0].id || null;
}

/** Mapa símbolo → id, uno a uno y con pausa para no saturar la API. */
async function symbolIds(symbols) {
  const map = {};
  for (const s of symbols || []) {
    try {
      const id = await symbolId(s);
      if (id) map[s] = id;
      await new Promise(r => setTimeout(r, 1200));
    } catch { /* seguimos */ }
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
  const desde = Number(rows[0][0]) || null;
  return {
    athUsd: hi, athDate: hiAt, atlUsd: lo, atlDate: loAt,
    ath: eurRate ? hi * eurRate : null,
    atl: eurRate ? lo * eurRate : null,
    athFrom: desde, atlFrom: desde,
  };
}

module.exports = { symbolId, symbolIds, athAtl, usdToEur, yearRange, binanceRange };
