'use strict';
// Pruebas de las tres piezas nuevas: indicadores, régimen, sizing y reality check.
// Sin red. Ejecutar con:  node tests/riesgo.test.js
const test = require('node:test');
const assert = require('node:assert');

const { sma, stdev, rsi, adx, atr, slope } = require('../lib/indicators');
const { detectRegime } = require('../lib/regime');
const { sizePortfolio, invert } = require('../lib/sizing');
const { realityCheck, positionsFor, binomP, STRATEGIES } = require('../lib/reality');

// ---------------------------------------------------------------- helpers
function serie(n, fn) {
  return Array.from({ length: n }, (_, i) => fn(i));
}

/** Velas diarias sintéticas a partir de una serie de cierres. */
function velas(closes, vol = 0.01) {
  return closes.map((c, i) => {
    const prev = i ? closes[i - 1] : c;
    return [i * 86400000, prev, c * (1 + vol), c * (1 - vol), c, 1000 + i];
  });
}

const ALCISTA = serie(400, i => 100 * Math.exp(i * 0.004 + Math.sin(i / 7) * 0.01));
const BAJISTA = serie(400, i => 100 * Math.exp(-i * 0.004 + Math.sin(i / 7) * 0.01));
const PLANA = serie(400, i => 100 + Math.sin(i / 9) * 0.4);

// ---------------------------------------------------------------- indicadores
test('sma y stdev devuelven null sin datos suficientes', () => {
  assert.strictEqual(sma([1, 2], 5), null);
  assert.strictEqual(stdev([1], 5), null);
  assert.strictEqual(sma([1, 2, 3, 4], 2), 3.5);
});

test('rsi se pega a 100 en subida pura y a 0 en bajada pura', () => {
  const sube = serie(40, i => 100 + i);
  const baja = serie(40, i => 200 - i);
  assert.ok(rsi(sube, 14) > 95);
  assert.ok(rsi(baja, 14) < 5);
});

test('adx detecta tendencia fuerte y atr mide rango', () => {
  const v = velas(ALCISTA, 0.005);
  const a = adx(v, 14);
  assert.ok(a && a.adx > 25, 'ADX de una tendencia fuerte debe pasar de 25');
  assert.ok(atr(v, 14) > 0);
});

test('slope es positivo en subida y negativo en bajada', () => {
  assert.ok(slope(serie(30, i => i * 2), 20) > 0);
  assert.ok(slope(serie(30, i => -i * 2), 20) < 0);
});

// ---------------------------------------------------------------- régimen
test('detectRegime: tendencia alcista', () => {
  const r = detectRegime(velas(ALCISTA));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.trend, 'alcista');
  assert.ok(r.confidence >= 0 && r.confidence <= 100);
  assert.ok(r.riskMultiplier >= 0.25 && r.riskMultiplier <= 1);
  assert.ok(r.vol30 > 0);
});

test('detectRegime: tendencia bajista', () => {
  const r = detectRegime(velas(BAJISTA));
  assert.strictEqual(r.trend, 'bajista');
});

test('detectRegime: serie lateral no se declara tendencia', () => {
  const r = detectRegime(velas(PLANA, 0.002));
  assert.strictEqual(r.trend, 'lateral');
});

test('detectRegime: sin velas suficientes devuelve error, no inventa', () => {
  const r = detectRegime(velas(serie(20, i => 100 + i)));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /velas/);
});

// ---------------------------------------------------------------- sizing
test('invert resuelve una matriz pequeña', () => {
  const inv = invert([[2, 0], [0, 4]]);
  assert.ok(Math.abs(inv[0][0] - 0.5) < 1e-12);
  assert.ok(Math.abs(inv[1][1] - 0.25) < 1e-12);
  assert.strictEqual(invert([[1, 1], [1, 1]]), null);
});

test('sizing: los pesos suman 100 % y el tope se respeta', () => {
  const rets = {
    AAA: serie(160, i => Math.sin(i * 2.1) * 0.01),
    BBB: serie(160, i => Math.sin(i * 2.7) * 0.03),
    CCC: serie(160, i => Math.sin(i * 3.3) * 0.05),
  };
  const out = sizePortfolio([
    { symbol: 'AAA', value: 5000 },
    { symbol: 'BBB', value: 3000 },
    { symbol: 'CCC', value: 2000 },
  ], rets, { maxWeight: 0.35 });
  assert.strictEqual(out.ok, true);
  const suma = out.rows.reduce((a, r) => a + r.target, 0);
  assert.ok(Math.abs(suma - 1) < 1e-9, 'los pesos deben sumar 1');
  for (const r of out.rows) assert.ok(r.target <= 0.35 + 1e-6, r.symbol + ' pasa del tope');
});

test('sizing: la moneda estable pesa más que la volátil', () => {
  const rets = {
    CALM: serie(160, i => Math.sin(i * 1.7) * 0.005),
    VOLA: serie(160, i => Math.sin(i * 4.1) * 0.06),
  };
  const out = sizePortfolio([{ symbol: 'CALM', value: 5000 }, { symbol: 'VOLA', value: 5000 }], rets, { maxWeight: 0.9 });
  const calma = out.rows.find(r => r.symbol === 'CALM');
  const vola = out.rows.find(r => r.symbol === 'VOLA');
  assert.ok(calma.target > vola.target, 'menos volatilidad debería pesar más');
  assert.ok(calma.vol < vola.vol);
});

test('sizing: el efectivo no se reparte por riesgo', () => {
  const rets = {
    BTC: serie(160, i => Math.sin(i * 2.1) * 0.03),
    ETH: serie(160, i => Math.sin(i * 2.7) * 0.04),
    USDC: serie(160, () => 0),
  };
  const out = sizePortfolio([
    { symbol: 'BTC', value: 6000 },
    { symbol: 'ETH', value: 3000 },
    { symbol: 'USDC', value: 1000 },
  ], rets, { maxWeight: 0.5 });
  const usdc = out.rows.find(r => r.symbol === 'USDC');
  assert.ok(Math.abs(usdc.target - 0.1) < 1e-9, 'USDC mantiene su peso');
  assert.strictEqual(usdc.delta, 0);
  const suma = out.rows.reduce((a, r) => a + r.target, 0);
  assert.ok(Math.abs(suma - 1) < 1e-9);
});

test('sizing: con una sola moneda avisa en vez de inventar', () => {
  const out = sizePortfolio([{ symbol: 'BTC', value: 100 }], { BTC: serie(160, i => Math.sin(i)) });
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /dos monedas/);
});

// ---------------------------------------------------------------- reality
test('binomP: 50 % de acierto no es significativo; 60 % sostenido sí', () => {
  const flojo = binomP(500, 1000);
  const fuerte = binomP(600, 1000);
  assert.ok(flojo > 0.9, 'p ≈ 1 con la mitad de aciertos');
  assert.ok(fuerte < 0.001, 'p pequeño con 60 % de acierto');
});

test('positionsFor no mira el futuro: la primera señal depende solo del pasado', () => {
  const closes = serie(100, i => 100 + i);
  const { pos } = positionsFor(closes, 'momentum');
  assert.strictEqual(pos[0], 0, 'durante el calentamiento no hay posición');
  assert.strictEqual(pos[59], 0);
  assert.strictEqual(pos[80], 1, 'en subida pura el momentum va largo');
});

test('realityCheck: una tendencia alcista deja ganar a comprar y mantener', () => {
  const out = realityCheck(velas(ALCISTA), { costBps: 5 });
  assert.strictEqual(out.ok, true);
  const hold = out.rows.find(r => r.id === 'hold');
  assert.ok(hold.total > 0, 'comprar y mantener debe ganar en una subida');
  assert.ok(out.rows.length === STRATEGIES.length);
  assert.ok(out.days > 100);
});

test('realityCheck: menos velas que el mínimo devuelve error', () => {
  const out = realityCheck(velas(serie(50, i => 100 + i)));
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /velas/);
});

test('realityCheck: los costes empeoran la estrategia activa', () => {
  const v = velas(serie(600, i => 100 * Math.exp(i * 0.001 + Math.sin(i / 5) * 0.05)));
  const gratis = realityCheck(v, { costBps: 0 });
  const caro = realityCheck(v, { costBps: 50 });
  const m0 = gratis.rows.find(r => r.id === 'sma');
  const m1 = caro.rows.find(r => r.id === 'sma');
  assert.ok(m1.total < m0.total, 'con más coste, menos retorno');
});
