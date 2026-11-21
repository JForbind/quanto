'use strict';
// Pruebas de la lógica de copias: nombres, validación y rotación.
const test = require('node:test');
const assert = require('node:assert');
const b = require('../lib/backup');

test('backupName genera un nombre ordenable y parseable', () => {
  const d = new Date(Date.UTC(2026, 10, 21, 20, 45, 30));
  const name = b.backupName(d);
  assert.strictEqual(name, 'quanto-20261121-204530.json');
  assert.strictEqual(b.parseName(name), d.getTime());
});

test('parseName rechaza lo que no es una copia', () => {
  assert.strictEqual(b.parseName('quanto-2026.json'), null);
  assert.strictEqual(b.parseName('otra-cosa.json'), null);
  assert.strictEqual(b.parseName(''), null);
});

test('isValidName bloquea rutas y nombres raros', () => {
  assert.strictEqual(b.isValidName('quanto-20260101-000000.json'), true);
  assert.strictEqual(b.isValidName('../../etc/passwd'), false);
  assert.strictEqual(b.isValidName('quanto-20260101-000000.json.bak'), false);
  assert.strictEqual(b.isValidName('quanto-20261301-000000.json'), false, 'mes 13 no existe');
});

test('sortNames ordena de antigua a reciente e ignora basura', () => {
  const list = ['quanto-20260103-000000.json', 'basura.txt', 'quanto-20260101-000000.json', 'quanto-20260102-000000.json'];
  assert.deepStrictEqual(b.sortNames(list), [
    'quanto-20260101-000000.json',
    'quanto-20260102-000000.json',
    'quanto-20260103-000000.json',
  ]);
});

test('planPrune conserva las más recientes', () => {
  const list = ['quanto-20260101-000000.json', 'quanto-20260102-000000.json', 'quanto-20260103-000000.json', 'quanto-20260104-000000.json'];
  assert.deepStrictEqual(b.planPrune(list, 2), ['quanto-20260101-000000.json', 'quanto-20260102-000000.json']);
  assert.deepStrictEqual(b.planPrune(list, 10), []);
  assert.deepStrictEqual(b.planPrune(list, 0), ['quanto-20260101-000000.json', 'quanto-20260102-000000.json', 'quanto-20260103-000000.json']);
});

test('latest devuelve la copia más reciente', () => {
  assert.strictEqual(b.latest([]), null);
  assert.strictEqual(b.latest(['quanto-20260101-000000.json', 'quanto-20260201-000000.json']), 'quanto-20260201-000000.json');
});

test('isDue: sin copias toca; con una reciente no; con una vieja sí', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  assert.strictEqual(b.isDue([], 22, now), true);
  assert.strictEqual(b.isDue(['quanto-20261121-060000.json'], 22, now), false, '6 h después no toca');
  assert.strictEqual(b.isDue(['quanto-20261120-060000.json'], 22, now), true, '30 h después sí toca');
});
