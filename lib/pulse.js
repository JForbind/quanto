'use strict';
// Pulso de mercado: amplitud (cuántas monedas suben) y funding de perpetuos.
const MARKETS = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h';
const PREMIUM = 'https://fapi.binance.com/fapi/v1/premiumIndex';

async function fetchJson(url, ms = 9000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Quanto/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function getPulse() {
  const out = { at: Date.now(), source: 'CoinGecko + Binance' };

  const [markets, premium] = await Promise.all([
    fetchJson(MARKETS),
    fetchJson(PREMIUM).catch(() => []),
  ]);

  // --- amplitud del mercado (50 mayores)
  const coins = (Array.isArray(markets) ? markets : [])
    .map(c => ({ symbol: String(c.symbol || '').toUpperCase(), change: Number(c.price_change_percentage_24h) }))
    .filter(c => c.symbol && isFinite(c.change));
  const up = coins.filter(c => c.change > 0).length;
  out.breadth = {
    up,
    down: coins.length - up,
    total: coins.length,
    pctUp: coins.length ? (up / coins.length) * 100 : 0,
  };
  const STABLE = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDS', 'PYUSD', 'EURC', 'FIGR_HELOC', 'U']);
  const movers = coins.filter(c => !STABLE.has(c.symbol) && Math.abs(c.change) > 0.2);
  out.best = movers.slice().sort((a, b) => b.change - a.change).slice(0, 3);
  out.worst = movers.slice().sort((a, b) => a.change - b.change).slice(0, 3);

  // --- funding de perpetuos
  const rows = (Array.isArray(premium) ? premium : [])
    .map(p => {
      const sym = String(p.symbol || '');
      if (!sym.endsWith('USDT')) return null;
      const rate = Number(p.lastFundingRate);
      if (!isFinite(rate)) return null;
      return { symbol: sym.slice(0, -4), rate: rate * 100 };
    })
    .filter(Boolean);

  if (rows.length) {
    const rates = rows.map(r => r.rate);
    out.funding = {
      avg: rates.reduce((a, b) => a + b, 0) / rates.length,
      median: median(rates),
      count: rows.length,
      positive: rows.filter(r => r.rate > 0).length,
      map: Object.fromEntries(rows.map(r => [r.symbol, r.rate])),
    };
  }

  return out;
}

module.exports = { getPulse };
