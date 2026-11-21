'use strict';
// Pruebas del TWR: las aportaciones y retiradas no deben inflar el rendimiento.
const test = require('node:test');
const assert = require('node:assert');
const { computeTwr, tradeFlows, dayKey } = require('../lib/twr');

const D = (n) => Date.UTC(2026, 0, n); // 1..31 de enero de 2026

/** Serie plana o con variación diaria del precio, valor de cartera = unidades × precio. */
function serie(valores, startDay = 1) {
  return {
    points: valores.map((v, i) => ({ t: D(startDay + i), value: v })),
    ops: [],
  };
}

test('dayKey agrupa por día UTC', () => {
  assert.strictEqual(dayKey(Date.UTC(2026, 0, 5, 23, 59)), D(5));
});

test('sin flujos, el TWR es la variación del valor', () => {
  const r = computeTwr(serie([1000, 1100, 1210]));
  assert.strictEqual(r.ok, true);
  assert.ok(Math.abs(r.total - 0.21) < 1e-9, 'total ' + r.total);
});

test('una compra no cuenta como rendimiento', () => {
  // 1000 € el día 1; el día 2 meto 1000 € más y valgo 2000 (0 % real)
  const input = serie([1000, 2000, 2100]);
  input.ops = [{ type: 'buy', ts: D(2), paidEur: 1000, amount: 1, quotePrice: 1000 }];
  const r = computeTwr(input);
  assert.ok(Math.abs(r.total - 0.05) < 1e-9, 'debe rendir solo el 5 %, no el 110 %: ' + r.total);
  assert.strictEqual(r.flows, 1000);
});

test('una venta no cuenta como pérdida', () => {
  // 2000 €; el día 2 saco 1000 € y me quedan 1000 (0 % real), el día 3 sube a 1100
  const input = serie([2000, 1000, 1100]);
  input.ops = [{ type: 'sell', ts: D(2), paidEur: 1000, amount: 1, quotePrice: 1000 }];
  const r = computeTwr(input);
  assert.ok(Math.abs(r.total - 0.10) < 1e-9, 'debe rendir el 10 %: ' + r.total);
  assert.strictEqual(r.flows, -1000);
});

test('benchmark BTC y diferencia', () => {
  const input = serie([1000, 1100, 1200]);
  input.btc = [{ t: D(1), close: 100 }, { t: D(2), close: 110 }, { t: D(3), close: 130 }];
  const r = computeTwr(input);
  assert.ok(Math.abs(r.benchmark - 0.30) < 1e-9);
  assert.ok(Math.abs(r.diff - (r.total - 0.30)) < 1e-9);
});

test('filtra por días y calcula el anualizado', () => {
  const input = serie([1000, 1100, 1200, 1300]);
  input.btc = [{ t: D(1), close: 100 }, { t: D(4), close: 100 }];
  const r = computeTwr({ ...input, days: 1 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.days, 1);
  assert.ok(Math.abs(r.total - (1300 / 1200 - 1)) < 1e-9, 'solo el último tramo: ' + r.total);
  assert.ok(r.annual > 1, 'anualizado grande en 2 días');
  assert.ok(Math.abs(r.benchmark) < 1e-9, 'BTC plano');
});

test('puntos insuficientes avisan en vez de inventar', () => {
  assert.strictEqual(computeTwr({ points: [{ t: D(1), value: 100 }] }).ok, false);
  assert.strictEqual(computeTwr({ points: [] }).ok, false);
});

test('tradeFlows suma compras y resta ventas del mismo día', () => {
  const f = tradeFlows([
    { type: 'buy', ts: D(3), paidEur: 500 },
    { type: 'sell', ts: D(3), paidEur: 200 },
    { type: 'deposit', ts: D(3), amount: 9999 },
    { type: 'reward', ts: D(3), amount: 1 },
  ]);
  assert.strictEqual(f.get(D(3)), 300);
  assert.strictEqual(f.size, 1);
});
