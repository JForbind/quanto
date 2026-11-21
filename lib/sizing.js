'use strict';
// Dimensionado de posiciones: reparte el capital por riesgo, no por importe.
// Entrada: pesos actuales + retornos diarios de cada moneda.
// Salida: peso objetivo, volatilidad y riesgo de la cartera resultante.

const { stdev } = require('./indicators');

/** Inversa por Gauss-Jordan con pivoteo. Devuelve null si es singular. */
function invert(matrix) {
  const n = matrix.length;
  const m = matrix.map((row, i) => row.map(Number).concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    const p = m[col][col];
    for (let j = 0; j < 2 * n; j++) m[col][j] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (!f) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map(row => row.slice(n));
}

/**
 * @param {Array<{symbol:string,value:number,name?:string}>} positions
 * @param {Object<string, number[]>} returns  retornos diarios por símbolo
 * @param {{maxWeight?:number,minWeight?:number,alignDays?:number}} opts
 */
function sizePortfolio(positions, returns, opts = {}) {
  const maxWeight = opts.maxWeight != null ? Number(opts.maxWeight) : 0.35;
  const STABLE = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'EURC', 'EURT', 'USDE', 'PYUSD']);
  const minWeight = opts.minWeight != null ? Number(opts.minWeight) : 0.05;
  const alignDays = opts.alignDays != null ? Number(opts.alignDays) : 120;

  const list = (positions || []).filter(p => p && p.symbol && Number(p.value) > 0);
  const total = list.reduce((a, p) => a + Number(p.value), 0);
  if (!list.length || total <= 0) return { ok: false, error: 'Cartera vacía.' };

  const usable = [];
  const skipped = [];
  const cash = [];
  for (const p of list) {
    if (STABLE.has(String(p.symbol).toUpperCase())) { cash.push({ ...p, weight: Number(p.value) / total }); continue; }
    const r = (returns && returns[p.symbol]) || [];
    if (r.length < Math.max(30, alignDays * 0.5)) { skipped.push(p.symbol); continue; }
    usable.push({ ...p, rets: r.slice(-alignDays) });
  }
  if (usable.length < 2) {
    return { ok: false, error: 'Hacen falta al menos dos monedas con histórico suficiente.', skipped };
  }

  const n = usable.length;
  // Varianzas y matriz de correlación con series alineadas al final
  const ann = Math.sqrt(365);
  const sigmas = usable.map(u => (stdev(u.rets, u.rets.length) || 0) * ann);
  const corr = [];
  for (let i = 0; i < n; i++) {
    corr[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) { corr[i][j] = 1; continue; }
      const a = usable[i].rets;
      const b = usable[j].rets;
      const len = Math.min(a.length, b.length);
      if (len < 20) { corr[i][j] = 0; continue; }
      const xa = a.slice(-len);
      const xb = b.slice(-len);
      const ma = xa.reduce((s, v) => s + v, 0) / len;
      const mb = xb.reduce((s, v) => s + v, 0) / len;
      let cov = 0; let va = 0; let vb = 0;
      for (let k = 0; k < len; k++) {
        cov += (xa[k] - ma) * (xb[k] - mb);
        va += (xa[k] - ma) ** 2;
        vb += (xb[k] - mb) ** 2;
      }
      corr[i][j] = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
    }
  }

  // Covarianza anualizada + un pequeño ridge para que sea invertible
  const cov = corr.map((row, i) => row.map((c, j) => c * sigmas[i] * sigmas[j]));
  const meanVar = sigmas.reduce((a, s) => a + s * s, 0) / n;
  for (let i = 0; i < n; i++) cov[i][i] += meanVar * 0.05;

  const inv = invert(cov);
  if (!inv) return { ok: false, error: 'La matriz de covarianza no es invertible.' };

  // Mínima varianza: w ∝ Σ⁻¹ · 1
  let w = new Array(n).fill(0);
  for (let i = 0; i < n; i++) w[i] = inv[i].reduce((a, v) => a + v, 0);
  w = w.map(v => (v > 0 ? v : 0));
  const sum = w.reduce((a, v) => a + v, 0);
  if (sum <= 0) return { ok: false, error: 'No se pudo repartir el riesgo.' };
  w = w.map(v => v / sum);

  // Peso invertible: el efectivo (stablecoins) no entra en el reparto por riesgo.
  const cashWeight = cash.reduce((a, c) => a + c.weight, 0);
  const investable = 1 - cashWeight;
  if (investable > 0) w = w.map(v => v * investable);

  // Caps de peso máximo con redistribución. Si el tope es matemáticamente
  // imposible (n × cap < total invertible), se reparte a partes iguales.
  const cap = Math.max(maxWeight * investable, investable / n);
  for (let iter = 0; iter < 40; iter++) {
    let over = 0;
    const free = [];
    for (let i = 0; i < n; i++) {
      if (w[i] > cap + 1e-9) { over += w[i] - cap; w[i] = cap; }
      else free.push(i);
    }
    if (over <= 1e-9) break;
    const freeSum = free.reduce((a, i) => a + w[i], 0);
    if (freeSum <= 1e-12) break;
    for (const i of free) w[i] += over * (w[i] / freeSum);
    const s = w.reduce((a, v) => a + v, 0);
    if (s > 0) w = w.map(v => (v / s) * investable);
  }

  // Suelo por moneda: el optimizador no debe proponer salir de una posición que
  // ya tienes solo porque su correlación no aporte. Se redistribuye el exceso.
  const floor = Math.min(minWeight, investable / Math.max(1, n) / 2);
  if (floor > 0) {
    for (let iter = 0; iter < 20; iter++) {
      let deficit = 0;
      for (let i = 0; i < n; i++) {
        if (w[i] < floor - 1e-9) { deficit += floor - w[i]; w[i] = floor; }
      }
      if (deficit <= 1e-9) break;
      const pool = [];
      let poolSum = 0;
      for (let i = 0; i < n; i++) {
        const spare = w[i] - floor;
        if (spare > 1e-9) { pool.push(i); poolSum += spare; }
      }
      if (poolSum <= 1e-12) break;
      for (const i of pool) w[i] -= deficit * ((w[i] - floor) / poolSum);
      const s3 = w.reduce((a, v) => a + v, 0);
      if (s3 > 0) w = w.map(v => (v / s3) * investable);
    }
  }

  // Volatilidad y riesgo de la cartera objetivo
  let variance = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) variance += w[i] * w[j] * cov[i][j];
  const portVol = Math.sqrt(Math.max(0, variance));
  const portVolNow = (() => {
    const cur = usable.map(u => Number(u.value) / total);
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += cur[i] * cur[j] * cov[i][j];
    return Math.sqrt(Math.max(0, v));
  })();

  const rows = usable.map((u, i) => ({
    symbol: u.symbol,
    name: u.name || u.symbol,
    current: Number(u.value) / total,
    target: w[i],
    delta: w[i] - Number(u.value) / total,
    vol: sigmas[i],
    value: Number(u.value),
  })).sort((a, b) => b.target - a.target);
  for (const c of cash) {
    rows.push({ symbol: c.symbol, name: c.name || c.symbol, current: c.weight, target: c.weight, delta: 0, vol: 0, value: Number(c.value), cash: true });
  }

  const maxCurrent = Math.max(...rows.map(r => r.current));
  const notes = [];
  if (maxCurrent > maxWeight + 0.05) {
    notes.push(`${rows.find(r => r.current === maxCurrent).symbol} pesa ${(maxCurrent * 100).toFixed(0)} %, por encima del máximo del ${(maxWeight * 100).toFixed(0)} %.`);
  }
  if (portVol > portVolNow * 1.15) notes.push('La cartera objetivo tiene más volatilidad que la actual: el reparto por riesgo concentra en las monedas más estables.');
  if (skipped.length) notes.push('Sin histórico suficiente: ' + skipped.join(', ') + '.');
  if (cash.length) notes.push('El efectivo (' + cash.map(c => c.symbol).join(', ') + ') no entra en el reparto por riesgo.');
  if (floor > 0) notes.push(`Cada moneda conserva al menos un ${(floor * 100).toFixed(0)} %: el reparto no te saca de una posición que ya tienes.`);

  return {
    ok: true,
    total,
    days: alignDays,
    maxWeight,
    rows,
    skipped,
    portfolioVol: portVol,
    portfolioVolNow: portVolNow,
    risk95: portVol * 1.645,
    notes,
  };
}

module.exports = { sizePortfolio, invert };
