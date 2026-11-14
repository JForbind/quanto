'use strict';
// La importación de CSV nunca debe borrar operaciones existentes.
const assert = require('assert');
const { mergeOps } = require('../lib/history');

let ok = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FALLO ' + name + ': ' + e.message); process.exitCode = 1; }
}

const op = (id, ts, currency, amount, paidEur) => ({
  id, ts, type: 'buy', currency, amount, paidEur, source: 'csv',
});

console.log('Fusión de historial (import no destructiva)');
test('no elimina operaciones que no vienen en el nuevo CSV', () => {
  const actual = [op('a', 1000, 'BTC', 1, 100), op('b', 2000, 'ETH', 2, 50)];
  const nuevo = [op('c', 3000, 'SOL', 3, 30)];
  const r = mergeOps(actual, nuevo);
  assert.strictEqual(r.ops.length, 3);
  assert(r.ops.find(o => o.id === 'a'), 'la operación antigua debe seguir');
  assert(r.ops.find(o => o.id === 'b'), 'la operación antigua debe seguir');
  assert.strictEqual(r.added, 1);
});

test('no duplica una operación que ya estaba', () => {
  const actual = [op('a', 1000, 'BTC', 1, 100)];
  const r = mergeOps(actual, [op('a', 1000, 'BTC', 1, 100)]);
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.added, 0);
});

test('completa datos que faltaban sin duplicar', () => {
  const actual = [{ id: 'a', ts: 1000, type: 'buy', currency: 'BTC', amount: 1 }];
  const r = mergeOps(actual, [op('a', 1000, 'BTC', 1, 250)]);
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.ops[0].paidEur, 250);
});

test('un CSV parcial no reduce el historial', () => {
  const actual = [op('a', 1000, 'BTC', 1, 100), op('b', 2000, 'ETH', 2, 50), op('c', 3000, 'XRP', 3, 30)];
  const parcial = [op('b', 2000, 'ETH', 2, 50)];
  const r = mergeOps(actual, parcial);
  assert.strictEqual(r.ops.length, 3, 'deben seguir las tres');
  assert.strictEqual(r.added, 0);
});

test('un CSV de otra cuenta se suma, no sustituye', () => {
  const cuenta1 = [op('a', 1000, 'BTC', 1, 100)];
  const cuenta2 = [op('z', 5000, 'BTC', 0.5, 200)];
  const r = mergeOps(cuenta1, cuenta2);
  assert.strictEqual(r.ops.length, 2);
  assert.strictEqual(r.added, 1);
});

console.log('\n' + ok + ' pruebas correctas');
