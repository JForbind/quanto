'use strict';
// Pruebas de los formateadores del front (ESM).
const test = require('node:test');
const assert = require('node:assert');

let core;
let ranges;
test('cargar los módulos del front', async () => {
  core = await import('../public/src/core.js');
  ranges = await import('../public/src/data/ranges.js');
  assert.ok(core.num && ranges.rangeFmt);
});

test('num usa coma decimal y punto de miles', () => {
  assert.strictEqual(core.num(1234.5, 2), '1.234,5');
  assert.strictEqual(core.num(0.5, 4), '0,5');
  assert.strictEqual(core.num(null), '—');
});

test('eur y pct', () => {
  assert.strictEqual(core.eur(1234.5), '1.234,50 €');
  assert.strictEqual(core.pct(2.5), '+2,5 %');
  assert.strictEqual(core.pct(-2.5), '-2,5 %');
  assert.strictEqual(core.pct(2.55), '+2,55 %');
});

test('rangeFmt elige decimales según la magnitud', () => {
  assert.strictEqual(ranges.rangeFmt(0.0005), '0,0005');
  assert.strictEqual(ranges.rangeFmt(0.5), '0,5');
  assert.strictEqual(ranges.rangeFmt(5), '5');
  assert.strictEqual(ranges.rangeFmt(500), '500');
  assert.match(ranges.rangeFmt(1234.5), /1\.?234,50\s*€/);
  assert.strictEqual(ranges.rangeFmt(0), '—');
});
