'use strict';
// Pruebas del informe de coherencia (texto determinista, sin red).
const test = require('node:test');
const assert = require('node:assert');
const c = require('../lib/coherence');

const regimes = [
  { ok: true, symbol: 'XRP', trend: 'lateral', volState: 'media', volPercentile: 0.38 },
  { ok: true, symbol: 'HBAR', trend: 'bajista', volState: 'alta', volPercentile: 0.72 },
];
const sizing = {
  ok: true,
  portfolioVol: 0.42,
  portfolioVolNow: 0.62,
  rows: [
    { symbol: 'XRP', current: 0.758, target: 0.05, value: 3000 },
    { symbol: 'BNB', current: 0.003, target: 0.30, value: 12 },
    { symbol: 'USDC', current: 0.05, target: 0.05, value: 200, cash: true },
  ],
};
const twr = { ok: true, total: -0.5, benchmark: -0.25, diff: -0.25, days: 365 };

test('el informe incluye régimen, rentabilidad y reparto', () => {
  const r = c.build({ regimes, sizing, twr, total: 4000, now: Date.UTC(2026, 10, 21) });
  assert.match(r.text, /RÉGIMEN/);
  assert.match(r.text, /XRP: sin dirección/);
  assert.match(r.text, /HBAR: bajista/);
  assert.match(r.text, /TWR/);
  assert.match(r.text, /-25,0 pp|−25,0 pp/);
  assert.match(r.text, /REPARTO POR RIESGO/);
  assert.match(r.text, /XRP: 75,8 % ahora/);
  assert.match(r.html, /<h2/);
  assert.match(r.subject, /coherencia/);
});

test('avisa de volatilidad alta y de desviaciones grandes', () => {
  const r = c.build({ regimes, sizing, twr, total: 4000 });
  assert.ok(r.warnings.some(w => /HBAR.*volatilidad alta/.test(w)), r.warnings.join(' | '));
  assert.ok(r.warnings.some(w => /XRP: 76 %/.test(w)));
  assert.ok(r.warnings.some(w => /volatilidad actual/.test(w)));
});

test('no inventa secciones si no hay datos', () => {
  const r = c.build({ regimes: [], sizing: null, twr: null, total: 0 });
  assert.match(r.text, /Sin datos suficientes/);
  assert.strictEqual(r.sections.length, 0);
});

test('formatea porcentajes en español', () => {
  assert.strictEqual(c.pct(0.1234), '+12,3 %');
  assert.strictEqual(c.pct(-0.5), '-50,0 %'.replace('-', '-'));
  assert.strictEqual(c.pp(-0.25), '-25,0 pp');
  assert.strictEqual(c.money(3888), '3.888 €');
});
