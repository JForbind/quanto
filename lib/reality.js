'use strict';
// Reality check: evalúa estrategias con reglas fijas sobre velas diarias.
// Sin look-ahead (cada señal usa solo datos hasta ese día), con costes y
// contraste estadístico contra el azar. Portado del laboratorio en Python.
const { sma, rsi } = require('./indicators');

const WARMUP = 60; // días de calentamiento que no se evalúan

const STRATEGIES = [
  { id: 'hold', name: 'Comprar y mantener', desc: 'Siempre invertido; es la referencia.' },
  { id: 'momentum', name: 'Momentum 20 d', desc: 'Largo si el cierre supera el de hace 20 días; corto si no.' },
  { id: 'sma', name: 'Cruce SMA 20/50', desc: 'Largo si la media de 20 está sobre la de 50; corto si está debajo.' },
  { id: 'rsi', name: 'Reversión RSI 30/70', desc: 'Largo con RSI < 30, corto con RSI > 70, fuera cuando no hay señal.' },
  { id: 'breakout', name: 'Ruptura 20 d', desc: 'Largo en máximos de 20 días, corto en mínimos de 20.' },
];

function positionsFor(closes, id) {
  const n = closes.length;
  const pos = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < WARMUP) { pos[i] = 0; continue; }
    const window = closes.slice(0, i + 1);
    switch (id) {
      case 'hold':
        pos[i] = 1;
        break;
      case 'momentum':
        pos[i] = i >= 20 ? (closes[i] > closes[i - 20] ? 1 : -1) : 0;
        break;
      case 'sma': {
        const a = sma(window, 20);
        const b = sma(window, 50);
        pos[i] = a != null && b != null ? (a > b ? 1 : -1) : 0;
        break;
      }
      case 'rsi': {
        const r = rsi(window, 14);
        pos[i] = r == null ? 0 : r < 30 ? 1 : r > 70 ? -1 : 0;
        break;
      }
      case 'breakout': {
        const hi = Math.max(...closes.slice(i - 19, i + 1));
        const lo = Math.min(...closes.slice(i - 19, i + 1));
        pos[i] = closes[i] >= hi ? 1 : closes[i] <= lo ? -1 : 0;
        break;
      }
      default:
        pos[i] = 0;
    }
  }
  // predicción de precio (solo para las que predicen un retorno)
  const predRet = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (id === 'momentum' && i >= 20) {
      let s = 0;
      for (let k = i - 19; k <= i; k++) s += Math.log(closes[k] / (k > 0 ? closes[k - 1] : closes[k])) || 0;
      predRet[i] = s / 20;
    }
  }
  return { pos, predRet };
}

function erfc(x) {
  // Abramowitz & Stegun 7.1.26
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 +
    t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
        t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** p-valor bilateral del acierto direccional frente al 50 %. */
function binomP(hit, n) {
  if (!n) return null;
  const z = (Math.abs(hit - n / 2) - 0.5) / Math.sqrt(n / 4);
  if (z <= 0) return 1;
  return Math.min(1, erfc(z / Math.SQRT2));
}

function evaluate(closes, id, costBps) {
  const n = closes.length;
  const { pos, predRet } = positionsFor(closes, id);
  const cost = costBps / 10000;
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  let prev = 0;
  let trades = 0;
  let wins = 0;
  let hit = 0;
  let tot = 0;
  let exposure = 0;
  let mae = 0;
  let maeN = 0;
  const curve = [1];
  for (let i = WARMUP; i < n - 1; i++) {
    const r = Math.log(closes[i + 1] / closes[i]);
    const want = pos[i];
    eq *= Math.exp(want * r - Math.abs(want - prev) * cost);
    if (want !== prev && want !== 0) {
      trades++;
      if (want * r > 0) wins++;
    }
    if (want !== 0) {
      exposure++;
      if (predRet[i] != null) {
        const predicted = closes[i] * Math.exp(predRet[i]);
        mae += Math.abs(predicted - closes[i + 1]) / closes[i + 1];
        maeN++;
        tot++;
        if (Math.sign(predRet[i]) === Math.sign(r) && Math.abs(r) > 1e-9) hit++;
      }
    }
    prev = want;
    peak = Math.max(peak, eq);
    mdd = Math.max(mdd, 1 - eq / peak);
    curve.push(eq);
  }
  const days = n - 1 - WARMUP;
  const years = days / 365;
  const rs = [];
  for (let k = 1; k < curve.length; k++) rs.push(Math.log(curve[k] / curve[k - 1]));
  const mean = rs.reduce((a, b) => a + b, 0) / (rs.length || 1);
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rs.length - 1));
  return {
    id,
    total: (eq - 1) * 100,
    cagr: eq > 0 ? (eq ** (1 / years) - 1) * 100 : -100,
    sharpe: sd ? (mean / sd) * Math.sqrt(365) : 0,
    mdd: mdd * 100,
    trades,
    win: trades ? (wins / trades) * 100 : null,
    acc: tot ? (hit / tot) * 100 : null,
    pvalue: tot ? binomP(hit, tot) : null,
    mae: maeN ? (mae / maeN) * 100 : null,
    exposure: days ? (exposure / days) * 100 : 0,
    curve,
  };
}

/**
 * @param {Array} candles velas ascendentes [ts,o,h,l,c,v]
 * @param {{costBps?:number, strategies?:string[]}} opts
 */
function realityCheck(candles, opts = {}) {
  const rows = (Array.isArray(candles) ? candles : []).filter(c => Array.isArray(c) && c.length >= 5);
  if (rows.length < WARMUP + 120) {
    return { ok: false, error: 'Hacen falta al menos ' + (WARMUP + 120) + ' velas diarias para un resultado honesto.' };
  }
  const costBps = opts.costBps != null ? Math.max(0, Math.min(100, Number(opts.costBps))) : 5;
  const wanted = Array.isArray(opts.strategies) && opts.strategies.length
    ? opts.strategies.filter(id => STRATEGIES.some(s => s.id === id))
    : STRATEGIES.map(s => s.id);

  const closes = rows.map(r => Number(r[4]));
  const results = wanted.map(id => {
    const res = evaluate(closes, id, costBps);
    const meta = STRATEGIES.find(s => s.id === id);
    return { ...res, name: meta ? meta.name : id, desc: meta ? meta.desc : '' };
  });

  const bh = results.find(r => r.id === 'hold') || evaluate(closes, 'hold', costBps);
  const beat = results.filter(r => r.id !== 'hold' && r.sharpe > bh.sharpe && r.total > bh.total);
  let note;
  if (!beat.length) {
    note = 'Ninguna estrategia bate a comprar y mantener en retorno y Sharpe. Es lo habitual: el coste de operar rara vez compensa.';
  } else {
    const nm = beat.map(r => r.name);
    const lista = nm.length === 1 ? nm[0] : nm.slice(0, -1).join(', ') + ' y ' + nm[nm.length - 1];
    note = (nm.length === 1 ? lista + ' supera' : lista + ' superan') + ' a comprar y mantener en este periodo. Comprueba que no sea casualidad: cambia el periodo y el activo.';
  }

  return {
    ok: true,
    days: rows.length - 1 - WARMUP,
    from: Number(rows[WARMUP][0]),
    to: Number(rows[rows.length - 1][0]),
    costBps,
    bh: { total: bh.total, cagr: bh.cagr, sharpe: bh.sharpe, mdd: bh.mdd },
    rows: results,
    strategies: STRATEGIES,
    note,
  };
}

module.exports = { realityCheck, evaluate, positionsFor, STRATEGIES, WARMUP, binomP };
