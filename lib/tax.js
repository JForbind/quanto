'use strict';
// Informe fiscal para la declaración española (Modelo 100).
// Método FIFO: al vender se consumen primero las compras más antiguas.
// En España no se impone un método concreto, pero hay que ser coherente; FIFO es
// el criterio más habitual y el que usa esta app para el informe.
const { round, num } = require('./util');

// Tramos de la base del ahorro (ejercicios 2023-2026).
const BRACKETS = [
  { upTo: 6000, rate: 0.19 },
  { upTo: 50000, rate: 0.21 },
  { upTo: 200000, rate: 0.23 },
  { upTo: 300000, rate: 0.27 },
  { upTo: Infinity, rate: 0.30 },
];

function estimateTax(base) {
  if (!(base > 0)) return 0;
  let rest = base;
  let previous = 0;
  let tax = 0;
  for (const b of BRACKETS) {
    const slice = Math.min(rest, b.upTo - previous);
    if (slice <= 0) break;
    tax += slice * b.rate;
    rest -= slice;
    previous = b.upTo;
  }
  return round(tax);
}

function marginRate(base) {
  if (!(base > 0)) return 0;
  let rest = base;
  let previous = 0;
  let rate = 0;
  for (const b of BRACKETS) {
    const slice = Math.min(rest, b.upTo - previous);
    if (slice <= 0) break;
    rate = b.rate;
    rest -= slice;
    previous = b.upTo;
  }
  return rate;
}

/** Lotes FIFO vivos (puede limitarse a una fecha). */
function fifoLotsAt(ops, untilTs) {
  const sorted = (ops || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const lots = {};
  for (const op of sorted) {
    if (!op.currency || op.currency === 'EUR') continue;
    if (untilTs && (op.ts || 0) > untilTs) continue;
    const s = op.currency;
    if (!lots[s]) lots[s] = [];
    if (op.type === 'buy') {
      const feeEur = op.feeCurrency === 'EUR' ? num(op.fee) : 0;
      const cost = op.paidEur || (op.amount * num(op.quotePrice) + feeEur);
      if (op.amount > 0) lots[s].push({ amount: op.amount, unitCost: cost / op.amount, ts: op.ts || 0 });
    } else if (op.type === 'sell') {
      consume(lots[s], op.amount);
    }
  }
  return lots;
}

function consume(lots, amount) {
  let rest = amount;
  while (rest > 1e-12 && lots.length) {
    const lot = lots[0];
    const take = Math.min(lot.amount, rest);
    lot.amount -= take;
    rest -= take;
    if (lot.amount <= 1e-12) lots.shift();
  }
  return rest;
}

function taxReport(ops) {
  const sorted = (ops || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const lots = {};
  const disposals = [];

  for (const op of sorted) {
    if (!op.currency || op.currency === 'EUR') continue;
    const s = op.currency;
    if (!lots[s]) lots[s] = [];
    if (op.type === 'buy') {
      const feeEur = op.feeCurrency === 'EUR' ? num(op.fee) : 0;
      const cost = op.paidEur || (op.amount * num(op.quotePrice) + feeEur);
      if (op.amount > 0) lots[s].push({ amount: op.amount, unitCost: cost / op.amount, ts: op.ts || 0 });
    } else if (op.type === 'sell') {
      const consumed = [];
      let rest = op.amount;
      let cost = 0;
      while (rest > 1e-12 && lots[s].length) {
        const lot = lots[s][0];
        const take = Math.min(lot.amount, rest);
        cost += take * lot.unitCost;
        consumed.push({ ts: lot.ts, amount: round(take, 8), unitCost: lot.unitCost });
        lot.amount -= take;
        rest -= take;
        if (lot.amount <= 1e-12) lots[s].shift();
      }
      const feeEur = op.feeCurrency === 'EUR' ? num(op.fee) : 0;
      const totalProceeds = op.paidEur || (op.amount * num(op.quotePrice) - feeEur);
      const matched = Math.max(0, op.amount - rest);
      const proportion = op.amount > 0 ? matched / op.amount : 0;
      const proceeds = totalProceeds * proportion;
      const unmatchedProceeds = totalProceeds - proceeds;
      disposals.push({
        ts: op.ts,
        symbol: s,
        amount: round(op.amount, 8),
        price: op.quotePrice || (op.amount ? totalProceeds / op.amount : 0),
        proceeds: round(proceeds, 2),
        cost: round(cost, 2),
        gain: round(proceeds - cost, 2),
        unmatchedAmount: round(rest, 8),
        unmatchedProceeds: round(unmatchedProceeds, 2),
        lots: consumed,
      });
    }
  }

  const byYear = new Map();
  for (const d of disposals) {
    const year = new Date(d.ts || 0).getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, { year, disposals: [], proceeds: 0, cost: 0, gain: 0, count: 0, unmatchedProceeds: 0 });
    const y = byYear.get(year);
    y.disposals.push(d);
    y.proceeds += d.proceeds;
    y.cost += d.cost;
    y.gain += d.gain;
    y.count++;
    y.unmatchedProceeds += d.unmatchedProceeds;
  }

  const years = [...byYear.values()]
    .sort((a, b) => b.year - a.year)
    .map(y => {
      const out = {
        year: y.year,
        count: y.count,
        proceeds: round(y.proceeds, 2),
        cost: round(y.cost, 2),
        gain: round(y.gain, 2),
        unmatchedProceeds: round(y.unmatchedProceeds, 2),
        incomplete: y.unmatchedProceeds > 0.005,
        disposals: y.disposals.sort((a, b) => (b.ts || 0) - (a.ts || 0)),
      };
      out.tax = out.gain > 0 ? estimateTax(out.gain) : 0;
      out.marginRate = out.gain > 0 ? marginRate(out.gain) : 0;
      out.taxSaving = out.gain < 0 ? round(-out.gain * 0.19) : 0;
      return out;
    });

  const inventory = {};
  for (const [s, list] of Object.entries(lots)) {
    const amount = list.reduce((a, l) => a + l.amount, 0);
    if (amount <= 1e-12) continue;
    const cost = list.reduce((a, l) => a + l.amount * l.unitCost, 0);
    inventory[s] = {
      symbol: s,
      amount: round(amount, 8),
      cost: round(cost, 2),
      avgCost: cost / amount,
      oldest: list[0] ? list[0].ts : null,
      lots: list.length,
    };
  }

  const totalGain = round(disposals.reduce((a, d) => a + d.gain, 0));
  const totalProceeds = round(disposals.reduce((a, d) => a + d.proceeds, 0));
  const totalCost = round(disposals.reduce((a, d) => a + d.cost, 0));
  const unmatchedProceeds = round(disposals.reduce((a, d) => a + d.unmatchedProceeds, 0));

  return {
    ok: true,
    years,
    disposals,
    inventory,
    totals: {
      gain: totalGain,
      proceeds: totalProceeds,
      cost: totalCost,
      count: disposals.length,
      unmatchedProceeds,
      tax: years.reduce((a, y) => a + y.tax, 0),
      losses: round(years.filter(y => y.gain < 0).reduce((a, y) => a + -y.gain, 0)),
    },
    brackets: BRACKETS.filter(b => isFinite(b.upTo)).map(b => ({ upTo: b.upTo, rate: b.rate })),
  };
}

/** Simulación de una venta por FIFO y por coste medio. */
function simulateSale(ops, symbol, amount) {
  const sym = String(symbol || '').toUpperCase();
  const qty = Math.max(0, num(amount));
  const sorted = (ops || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const lots = (fifoLotsAt(sorted, null)[sym] || []).slice();

  const totalAmount = lots.reduce((a, l) => a + l.amount, 0);
  const totalCost = lots.reduce((a, l) => a + l.amount * l.unitCost, 0);
  const avgCost = totalAmount > 0 ? totalCost / totalAmount : null;

  let rest = qty;
  let fifoCost = 0;
  const usedLots = [];
  for (const lot of lots) {
    if (rest <= 1e-12) break;
    const take = Math.min(lot.amount, rest);
    fifoCost += take * lot.unitCost;
    usedLots.push({ ts: lot.ts, amount: round(take, 8), unitCost: lot.unitCost });
    rest -= take;
  }
  const matched = qty - rest;

  return {
    symbol: sym,
    amount: qty,
    available: round(totalAmount, 8),
    avgCost,
    totalCost: round(totalCost, 2),
    fifoCost: round(fifoCost, 2),
    fifoLots: usedLots,
    unmatchedAmount: round(rest, 8),
    matchedAmount: round(matched, 8),
    avgCostUsed: avgCost !== null ? round(avgCost * matched, 2) : 0,
  };
}

module.exports = { taxReport, simulateSale, estimateTax, marginRate, fifoLotsAt, BRACKETS };
