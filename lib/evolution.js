'use strict';
// Serie histórica reconstruida: valor diario de la cartera desde la primera compra.
const { round } = require('./util');

function evolutionSeries(ops, pricesBySymbol, opts = {}) {
  const dayMs = 86400e3;
  const trades = (ops || [])
    .filter(o => o.currency && o.currency !== 'EUR' && (o.type === 'buy' || o.type === 'sell' || o.type === 'reward'))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!trades.length) return [];

  const start = new Date(trades[0].ts || 0);
  start.setUTCHours(0, 0, 0, 0);
  const end = opts.until ? new Date(opts.until) : new Date();
  end.setUTCHours(0, 0, 0, 0);
  if (end.getTime() < start.getTime()) return [];

  const symbols = [...new Set(trades.map(o => o.currency))];
  const lots = {};
  const cursor = {};
  for (const s of symbols) {
    lots[s] = [];
    cursor[s] = { i: 0, last: null, series: (pricesBySymbol[s] || []).slice().sort((a, b) => a.t - b.t) };
  }
  const priceAt = (s, ts) => {
    const c = cursor[s];
    if (!c) return null;
    while (c.i < c.series.length && c.series[c.i].t <= ts) { c.last = c.series[c.i].close; c.i++; }
    return c.last;
  };

  const points = [];
  let idx = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
    while (idx < trades.length && (trades[idx].ts || 0) < t + dayMs) {
      const op = trades[idx++];
      const s = op.currency;
      if (!lots[s]) continue;
      if (op.type === 'sell') {
        let rest = op.amount;
        while (rest > 1e-12 && lots[s].length) {
          const lot = lots[s][0];
          const take = Math.min(lot.amount, rest);
          lot.amount -= take;
          rest -= take;
          if (lot.amount <= 1e-12) lots[s].shift();
        }
      } else {
        const feeEur = op.feeCurrency === 'EUR' ? (op.fee || 0) : 0;
        const cost = op.type === 'buy' ? (op.paidEur || (op.amount * (op.quotePrice || 0) + feeEur)) : 0;
        if (op.amount > 0) lots[s].push({ amount: op.amount, unitCost: cost / op.amount });
      }
    }
    let value = 0;
    let invested = 0;
    let priced = 0;
    for (const s of symbols) {
      const list = lots[s];
      if (!list || !list.length) continue;
      const amount = list.reduce((a, l) => a + l.amount, 0);
      if (amount <= 1e-12) continue;
      invested += list.reduce((a, l) => a + l.amount * l.unitCost, 0);
      const p = priceAt(s, t + dayMs - 1);
      if (p) { value += amount * p; priced += amount * p; }
    }
    // Solo añadimos puntos con datos de precio (evita caídas falsas a 0 al principio).
    if (priced > 0 || points.length) points.push({ t, value: round(value, 2), invested: round(invested, 2) });
  }
  return points;
}

module.exports = { evolutionSeries };
