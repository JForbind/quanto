'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { yearRange } = require('../lib/ranges');

test('yearRange usa solo el año en curso y guarda desde cuándo hay datos', () => {
  const y = new Date().getFullYear();
  const rows = [
    [new Date(y - 1, 5, 1).getTime(), 1, 10, 0.5, 1, 0],
    [new Date(y, 2, 1).getTime(), 1, 5, 0.4, 1, 0],
    [new Date(y, 3, 1).getTime(), 1, 8, 0.2, 1, 0],
  ];
  const r = yearRange(rows);
  assert.equal(r.year, y);
  assert.equal(r.high, 8);
  assert.equal(r.low, 0.2);
  assert.equal(new Date(r.from).getMonth(), 2);
});

test('yearRange sin velas del año devuelve null', () => {
  const y = new Date().getFullYear();
  assert.equal(yearRange([[new Date(y - 1, 0, 1).getTime(), 1, 2, 1, 1, 0]]), null);
});
