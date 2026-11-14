'use strict';
// Índice de liquidez: oferta de stablecoins (DefiLlama) + dominancia (CoinGecko).
const DEFILLAMA = 'https://stablecoins.llama.fi/stablecoincharts/all';
const COINGECKO = 'https://api.coingecko.com/api/v3/global';

async function fetchJson(url, ms = 9000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Quanto/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function pctChange(a, b) {
  if (!a || !b) return 0;
  return ((b - a) / a) * 100;
}

function stateFor(change30) {
  if (change30 >= 1.5) return { key: 'exp', label: 'Expansión' };
  if (change30 <= -1) return { key: 'cont', label: 'Contracción' };
  return { key: 'neutro', label: 'Neutro' };
}

async function getLiquidity() {
  const out = { at: Date.now(), source: 'DefiLlama + CoinGecko' };
  const [stable, global] = await Promise.all([
    fetchJson(DEFILLAMA),
    fetchJson(COINGECKO).catch(() => null),
  ]);

  const series = (Array.isArray(stable) ? stable : [])
    .map(s => ({
      t: Number(s.date) * 1000,
      v: Number((s.totalCirculatingUSD && s.totalCirculatingUSD.peggedUSD) || 0),
    }))
    .filter(p => isFinite(p.t) && p.v > 0);

  if (!series.length) throw new Error('Sin datos de stablecoins');

  const last = series[series.length - 1];
  const day = series[series.length - 2] || last;
  const week = series[series.length - 8] || series[0];
  const month = series[series.length - 31] || series[0];

  out.total = last.v;
  out.change24 = pctChange(day.v, last.v);
  out.change7 = pctChange(week.v, last.v);
  out.change30 = pctChange(month.v, last.v);
  out.state = stateFor(out.change30);

  if (global && global.data && global.data.market_cap_percentage) {
    const mcp = global.data.market_cap_percentage;
    const usdt = Number(mcp.usdt || 0);
    const usdc = Number(mcp.usdc || 0);
    out.dominance = usdt + usdc;
    out.usdt = usdt;
    out.usdc = usdc;
  }

  // Serie recortada para el gráfico (últimos 180 días, uno de cada 2)
  out.series = series.slice(-180).filter((_, i) => i % 2 === 0).map(p => [p.t, Math.round(p.v)]);

  return out;
}

module.exports = { getLiquidity };
