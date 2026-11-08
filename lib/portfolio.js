'use strict';
// Valoración de la cartera: saldos del exchange + histórico + wallet fría.
const { round, num } = require('./util');
const { analyze, storeMoves } = require('./history');
const { evolutionSeries } = require('./evolution');

const FALLBACK_PRICES = {
  BTC: 68000, ETH: 2500, SOL: 150, XRP: 1.1, ADA: 0.25, DOT: 1.5, MATIC: 0.5,
  LINK: 15, AVAX: 25, LTC: 70, DOGE: 0.15, BNB: 550,
};

/** Cantidad real de un saldo: GET /v2/balance devuelve {available, inOrder}. */
function balanceAmount(b) {
  if (!b) return 0;
  const available = num(b.available);
  const inOrder = num(b.inOrder);
  if (b.available !== undefined || b.inOrder !== undefined) return available + inOrder;
  return num(b.amount);
}

function buildPortfolio(opts) {
  const {
    mode = 'live', balances = [], prices = {}, dayChange = {},
    analysis = null, holdings = {}, overrides = {},
    importedAt = null, autoCaptured = 0, lastSyncAt = null,
  } = opts;

  const byCoin = analysis ? analysis.byCoin : {};
  const cold = holdings || {};
  const exBal = {};
  for (const b of balances) if (b && b.symbol) exBal[String(b.symbol).toUpperCase()] = balanceAmount(b);

  const symbols = new Set();
  for (const s of Object.keys(byCoin)) symbols.add(s);
  for (const s of Object.keys(exBal)) symbols.add(s);
  for (const s of Object.keys(cold)) symbols.add(s);
  symbols.delete('EUR');

  const coins = [];
  let cryptoValue = 0;
  let investedTotal = 0;
  let pnlTotal = 0;
  let coldValue = 0;
  let exchangeValue = 0;
  let dayChangeValue = 0;
  const unpriced = [];
  const noCost = [];

  for (const symbol of symbols) {
    const onExchange = exBal[symbol] || 0;
    const h = byCoin[symbol] || null;
    const manual = cold[symbol] || null;
    const manualAmount = manual ? num(manual.amount) : 0;

    // Lo que el historial dice que tienes y lo que dice que sigue en el exchange.
    const histOwned = h ? h.amount : 0;
    const histOnEx = h ? Math.max(0, (h.deposited || 0) + h.bought - h.sold - (h.withdrawn || 0)) : 0;
    const pendingAmount = h ? Math.max(0, onExchange - histOnEx) : 0;

    let amount = h ? histOwned + pendingAmount : Math.max(onExchange, manualAmount);
    amount = Math.max(amount, onExchange);
    if (amount <= 1e-12) continue;

    const price = num(prices[symbol]);
    const value = amount * price;
    const inCold = Math.max(0, amount - onExchange);

    let invested = null;
    let source = 'historial';
    if (overrides[symbol] !== undefined && overrides[symbol] !== null) {
      invested = num(overrides[symbol]);
      source = 'manual';
    } else if (h && h.avgCost !== null) {
      invested = h.avgCost * amount;
      source = pendingAmount > 0 ? 'estimado' : 'historial';
    } else if (manual && manual.invested !== undefined && manual.invested !== null && manual.invested !== '') {
      invested = num(manual.invested);
      source = 'manual';
    } else if (!h && manualAmount > 0) {
      invested = null;
      source = 'sin coste';
    }

    const costKnown = invested !== null && invested !== undefined;
    const pnl = costKnown ? value - invested : null;
    const pnlPct = costKnown && invested > 0 ? (pnl / invested) * 100 : null;
    const avgPrice = costKnown && amount > 0 ? invested / amount : (h && h.avgCost ? h.avgCost : null);

    cryptoValue += value;
    exchangeValue += onExchange * price;
    coldValue += inCold * price;
    if (costKnown) { investedTotal += invested; pnlTotal += pnl; } else { noCost.push(symbol); }
    if (price <= 0) unpriced.push(symbol);
    const change = num(dayChange[symbol]);
    if (dayChange[symbol] !== undefined && price > 0) {
      dayChangeValue += (value / (1 + change / 100)) * (change / 100);
    }

    coins.push({
      symbol,
      amount: round(amount, 8),
      onExchange: round(onExchange, 8),
      inCold: round(inCold, 8),
      price,
      value: round(value, 2),
      invested: costKnown ? round(invested, 2) : null,
      pnl: costKnown ? round(pnl, 2) : null,
      pnlPct: pnlPct === null ? null : round(pnlPct, 2),
      avgPrice: avgPrice ? round(avgPrice, 8) : null,
      dayChangePct: dayChange[symbol] !== undefined ? round(change, 2) : null,
      allocationPct: 0,
      share: 0,
      costKnown,
      source,
      pendingAmount: round(pendingAmount, 8),
    });
  }

  const cash = exBal.EUR || 0;
  coins.sort((a, b) => b.value - a.value);
  const totalValue = round(cryptoValue + cash);
  for (const c of coins) {
    c.allocationPct = totalValue > 0 ? round((c.value / totalValue) * 100, 2) : 0;
    c.share = cryptoValue > 0 ? round((c.value / cryptoValue) * 100, 2) : 0;
  }

  const withPnl = coins.filter(c => c.costKnown);
  const winners = withPnl.filter(c => c.pnl > 0).length;

  const warnings = [];
  if (mode === 'demo') {
    warnings.push({ code: 'demo', level: 'info', text: 'Modo DEMO: estos datos son de ejemplo. Conecta tu clave de Bitvavo (solo lectura) en Ajustes para ver tu cartera real.' });
  } else if (mode === 'history') {
    warnings.push({ code: 'history-mode', level: 'info', text: 'Vista desde tu historial: las cantidades salen del CSV importado, no del saldo real del exchange. Conecta tu clave de Bitvavo en Ajustes para sincronizar.' });
  }
  if (!analysis) {
    warnings.push({ code: 'no-history', level: 'info', text: 'Aún no has importado tu historial completo de Bitvavo. Las cantidades salen del exchange, pero el coste y el fiscal necesitan el CSV.' });
  } else if (pendingAmountTotal(coins) > 0) {
    warnings.push({ code: 'pending', level: 'warn', text: 'Hay operaciones nuevas en Bitvavo que aún no están en tu historial importado: su coste es estimado. Vuelve a importar el CSV cuando quieras precisión total.' });
  }
  if (noCost.length) {
    warnings.push({ code: 'no-cost', level: 'warn', text: `Sin coste conocido: ${noCost.join(', ')}. No se incluyen en el P/L hasta que tengan compra registrada.` });
  }
  if (analysis && analysis.realized.unmatchedProceeds > 0) {
    warnings.push({ code: 'unmatched', level: 'warn', text: `Hay ${analysis.realized.unmatchedProceeds.toFixed(2)} € en ventas sin compra registrada. Revisa el informe fiscal antes de declarar.` });
  }
  if (unpriced.length) {
    warnings.push({ code: 'unpriced', level: 'info', text: `Sin precio de mercado: ${unpriced.join(', ')}.` });
  }

  return {
    mode,
    updatedAt: new Date().toISOString(),
    currency: 'EUR',
    totalValue,
    cryptoValue: round(cryptoValue),
    cash: round(cash, 2),
    invested: round(investedTotal),
    pnl: round(pnlTotal),
    pnlPct: investedTotal > 0 ? round((pnlTotal / investedTotal) * 100, 2) : null,
    dayChangeValue: round(dayChangeValue),
    dayChangePct: totalValue > 0 ? round((dayChangeValue / totalValue) * 100, 2) : null,
    coinCount: coins.length,
    winRate: withPnl.length ? round((winners / withPnl.length) * 100, 1) : null,
    coins,
    prices,
    realized: analysis ? analysis.realized : null,
    totals: analysis ? analysis.totals : null,
    history: {
      imported: !!analysis,
      importedAt,
      autoCaptured,
      lastSyncAt,
      count: analysis ? analysis.range.count : 0,
      from: analysis ? analysis.range.from : null,
      to: analysis ? analysis.range.to : null,
    },
    storage: {
      coldValue: round(coldValue),
      exchangeValue: round(exchangeValue),
      cash: round(cash, 2),
      coldPct: totalValue > 0 ? round((coldValue / totalValue) * 100, 1) : 0,
      exchangePct: totalValue > 0 ? round((exchangeValue / totalValue) * 100, 1) : 0,
      coldCoins: coins.filter(c => c.inCold > 0).length,
      exchangeCoins: coins.filter(c => c.onExchange > 0).length,
      moves: analysis ? storeMoves(analysis.sorted) : [],
      pending: coins.filter(c => c.pendingAmount > 0).map(c => ({ symbol: c.symbol, amount: c.pendingAmount })),
    },
    warnings,
  };
}

function pendingAmountTotal(coins) {
  return coins.reduce((a, c) => a + (c.pendingAmount || 0), 0);
}

// ---------------------------------------------------------------- modo demo
const DEMO_COINS = [
  { symbol: 'BTC', buys: [{ d: 430, a: 0.018, f: 0.82 }, { d: 260, a: 0.014, f: 0.95 }, { d: 90, a: 0.0103, f: 1.02 }], withdraw: 0.02 },
  { symbol: 'ETH', buys: [{ d: 400, a: 0.55, f: 0.78 }, { d: 180, a: 0.43, f: 0.9 }, { d: 60, a: 0.432, f: 1.01 }], withdraw: 0.6 },
  { symbol: 'SOL', buys: [{ d: 300, a: 12, f: 0.7 }, { d: 120, a: 8.2, f: 0.96 }], sell: { d: 30, a: 5, f: 1.12 } },
  { symbol: 'XRP', buys: [{ d: 250, a: 400, f: 0.85 }, { d: 75, a: 220, f: 1.03 }] },
  { symbol: 'ADA', buys: [{ d: 210, a: 700, f: 0.9 }, { d: 95, a: 400, f: 1.0 }] },
  { symbol: 'DOT', buys: [{ d: 190, a: 18.5, f: 0.88 }, { d: 70, a: 7, f: 1.04 }] },
  { symbol: 'MATIC', buys: [{ d: 240, a: 1200, f: 0.8 }, { d: 110, a: 600, f: 0.98 }] },
];

function demoOps(prices) {
  const now = Date.now();
  const day = 86400e3;
  const ops = [];
  let n = 0;
  const priceOf = (s) => num(prices[s]) || FALLBACK_PRICES[s] || 0;
  ops.push({
    id: 'demo-dep-1', ts: now - 470 * day, type: 'deposit', currency: 'EUR', amount: 9000,
    paidCurrency: 'EUR', paidAmount: 9000, paidEur: 9000, fee: 0, feeCurrency: 'EUR',
  });
  for (const coin of DEMO_COINS) {
    const p = priceOf(coin.symbol);
    for (const b of coin.buys) {
      const amount = b.a;
      const unit = +(p * b.f).toFixed(6);
      const paid = +(amount * unit).toFixed(2);
      ops.push({
        id: 'demo-buy-' + (++n), ts: now - b.d * day, type: 'buy', currency: coin.symbol,
        amount, quoteCurrency: 'EUR', quotePrice: unit, paidCurrency: 'EUR', paidAmount: paid,
        paidEur: paid, fee: +(paid * 0.0025).toFixed(2), feeCurrency: 'EUR',
      });
    }
    if (coin.withdraw) {
      ops.push({
        id: 'demo-wd-' + (++n), ts: now - 20 * day, type: 'withdrawal', currency: coin.symbol,
        amount: coin.withdraw, fee: 0, feeCurrency: coin.symbol, paidCurrency: '', paidAmount: 0, paidEur: 0,
      });
    }
    if (coin.sell) {
      const unit = +(p * coin.sell.f).toFixed(6);
      const paid = +(coin.sell.a * unit).toFixed(2);
      ops.push({
        id: 'demo-sell-' + (++n), ts: now - coin.sell.d * day, type: 'sell', currency: coin.symbol,
        amount: coin.sell.a, quoteCurrency: 'EUR', quotePrice: unit, paidCurrency: 'EUR',
        paidAmount: paid, paidEur: paid, fee: +(paid * 0.0025).toFixed(2), feeCurrency: 'EUR',
      });
    }
  }
  return ops.sort((a, b) => a.ts - b.ts);
}

function demoPortfolio(prices, dayChange) {
  const ops = demoOps(prices);
  const analysis = analyze(ops);
  const balances = [];
  let cash = 0;
  for (const [symbol, g] of Object.entries(analysis.byCoin)) {
    const net = Math.max(0, g.bought - g.sold - g.withdrawn);
    balances.push({ symbol, available: String(net), inOrder: '0' });
  }
  for (const op of ops) {
    if (op.currency === 'EUR' && op.type === 'deposit') cash += op.amount;
    if (op.paidCurrency === 'EUR' && (op.type === 'buy' || op.type === 'sell')) cash += op.type === 'sell' ? op.paidEur : -op.paidEur;
  }
  balances.push({ symbol: 'EUR', available: String(Math.max(0, round(cash, 2))), inOrder: '0' });
  return buildPortfolio({ mode: 'demo', balances, prices, dayChange, analysis, holdings: {}, overrides: {} });
}

// Serie de precios sintética y determinista (para el modo demo).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function syntheticCloses(symbol, current, days = 750) {
  const rnd = mulberry32(hashStr(symbol) ^ 0x9e3779b9);
  const out = [];
  let p = current;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    out.push({ t: today.getTime() - i * 86400e3, close: p });
    const drift = 1 + (rnd() - 0.48) * 0.055;
    p = p / drift;
  }
  return out.reverse();
}

function demoEvolution(prices) {
  const ops = demoOps(prices);
  const series = {};
  const symbols = new Set(ops.filter(o => o.currency !== 'EUR').map(o => o.currency));
  for (const symbol of symbols) {
    series[symbol] = syntheticCloses(symbol, num(prices[symbol]) || FALLBACK_PRICES[symbol] || 1);
  }
  return evolutionSeries(ops, series);
}

module.exports = { buildPortfolio, demoPortfolio, demoOps, demoEvolution, balanceAmount, FALLBACK_PRICES };
