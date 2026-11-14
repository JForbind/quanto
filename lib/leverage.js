'use strict';
// Deuda y apalancamiento: préstamos DeFi (DefiLlama) y open interest (Binance).
const PROTOCOLS = [
  { slug: 'aave', name: 'Aave' },
  { slug: 'compound', name: 'Compound' },
];
const OI = [
  'https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1d&limit=31',
  'https://fapi.binance.com/futures/data/openInterestHist?symbol=ETHUSDT&period=1d&limit=31',
  'https://fapi.binance.com/futures/data/openInterestHist?symbol=SOLUSDT&period=1d&limit=31',
];
const GLOBAL = 'https://api.coingecko.com/api/v3/global';

async function fetchJson(url, ms = 9000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Quanto/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function pct(a, b) {
  if (!a || !b) return 0;
  return ((b - a) / a) * 100;
}

/** Series diarias de préstamos de un protocolo DefiLlama. */
function borrowedSeries(protocol) {
  const t = protocol && protocol.chainTvls && protocol.chainTvls.borrowed && protocol.chainTvls.borrowed.tvl;
  if (!Array.isArray(t)) return [];
  // Un solo valor por día (DefiLlama puede repetir la misma fecha).
  const byDay = new Map();
  for (const p of t) {
    const v = Number(p.totalLiquidityUSD) || 0;
    if (!(v > 0)) continue;
    const d = new Date(Number(p.date) * 1000).toISOString().slice(0, 10);
    byDay.set(d, v);
  }
  return [...byDay.entries()].map(([d, v]) => ({ d, v }));
}

async function getLeverage() {
  const out = { at: Date.now(), source: 'DefiLlama + Binance + CoinGecko' };

  const [protocols, oiResults, global] = await Promise.all([
    Promise.allSettled(PROTOCOLS.map(p => fetchJson('https://api.llama.fi/protocol/' + p.slug))),
    Promise.allSettled(OI.map(u => fetchJson(u))),
    fetchJson(GLOBAL).catch(() => null),
  ]);

  // --- deuda DeFi (suma de protocolos)
  let debt = 0;
  let debtPast = 0;
  const debtSeries = new Map();
  protocols.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const series = borrowedSeries(r.value);
    if (!series.length) return;
    const last = series[series.length - 1];
    const prev = series[Math.max(0, series.length - 31)] || series[0];
    debt += last.v;
    debtPast += prev.v;
    for (const p of series.slice(-180)) {
      debtSeries.set(p.d, (debtSeries.get(p.d) || 0) + p.v);
    }
  });

  // --- apalancamiento (open interest en USD)
  let oi = 0;
  let oiPast = 0;
  const oiByDay = new Map();
  oiResults.forEach(r => {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value) || !r.value.length) return;
    const rows = r.value.map(x => ({ t: Number(x.timestamp), v: Number(x.sumOpenInterestValue) || 0 })).filter(x => x.v > 0);
    if (!rows.length) return;
    oi += rows[rows.length - 1].v;
    oiPast += (rows[Math.max(0, rows.length - 31)] || rows[0]).v;
    for (const x of rows) {
      const d = new Date(x.t).toISOString().slice(0, 10);
      oiByDay.set(d, (oiByDay.get(d) || 0) + x.v);
    }
  });

  const marketCap = global && global.data && global.data.total_market_cap && global.data.total_market_cap.usd;

  out.debt = debt;
  out.debtChange30 = pct(debtPast, debt);
  out.oi = oi;
  out.oiChange30 = pct(oiPast, oi);
  out.marketCap = marketCap || null;
  out.leverage = marketCap ? (oi / marketCap) * 100 : null;

  // serie combinada (deuda + OI) para el gráfico, últimos 90 días
  const days = [...new Set([...debtSeries.keys(), ...oiByDay.keys()])].sort();
  out.series = days.slice(-90).map(d => ({
    d,
    debt: debtSeries.get(d) || null,
    oi: oiByDay.get(d) || null,
  }));

  // estado de riesgo
  const upDebt = out.debtChange30 > 5;
  const upOi = out.oiChange30 > 5;
  if (upDebt && upOi) out.risk = { key: 'alto', label: 'Riesgo alto' };
  else if (!upDebt && !upOi) out.risk = { key: 'bajo', label: 'Riesgo bajo' };
  else out.risk = { key: 'medio', label: 'Riesgo medio' };

  return out;
}

module.exports = { getLeverage };
