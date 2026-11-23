'use strict';
// Etiquetas de los rangos (fuente, cobertura, aviso). Módulo ESM: import dinámico.
const test = require('node:test');
const assert = require('node:assert');

test('etiquetas de los rangos', async () => {
  const { athFuente, anioCobertura, avisoExchange } = await import('../public/src/data/ranges.js');

  assert.match(athFuente({ ath: 1, athDate: Date.parse('2025-08-24T10:41:03Z') }), /^CoinGecko · .*2025/);
  assert.match(athFuente({ ath: 1, athApprox: true, athFrom: Date.parse('2017-08-17T00:00:00Z') }), /^Binance · desde 2017/);
  assert.equal(athFuente({}), '');

  const y = new Date().getFullYear();
  assert.equal(anioCobertura({ year: y, from: new Date(y, 2, 15).getTime() }), 'desde mar');
  assert.equal(anioCobertura({ year: y, from: new Date(y, 0, 3).getTime() }), '');
  assert.equal(anioCobertura({ year: y, from: new Date(y - 1, 6, 1).getTime() }), '');

  assert.equal(avisoExchange({ ath: 100, histHigh: 101 }), '');
  assert.match(avisoExchange({ ath: 100, histHigh: 120 }), /por encima del ATH global/);
  assert.equal(avisoExchange({ ath: 100, histHigh: 120, athApprox: true }), '');
});
