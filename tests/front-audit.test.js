'use strict';
// Auditoría del front de Quanto: formateadores de número/precio y cálculos
// exportables del simulador. Los valores esperados están verificados a mano.
// Los casos marcados con "BUG" documentan un defecto real: se espera el valor
// correcto (redondeo decimal) y el test FALLA porque el código actual se
// equivoca. El resto de casos confirman el comportamiento correcto (OK).
//
// Ejecutar: node --test tests/front-audit.test.js

const test = require('node:test');
const assert = require('node:assert');

let core;
let ranges;
let sim;

test.before(async () => {
  core = await import('../public/src/core.js');
  ranges = await import('../public/src/data/ranges.js');
  sim = await import('../public/src/views/sim.js');
});

/* ------------------------------------------------------------------ */
/* 1. num / groupNum: agrupación, coma decimal y coma flotante          */
/* ------------------------------------------------------------------ */

test('num agrupa miles desde 4 cifras y usa coma decimal', () => {
  assert.strictEqual(core.num(1234.5, 2), '1.234,5');
  assert.strictEqual(core.num(0.5, 4), '0,5');
  assert.strictEqual(core.num(999, 2), '999'); // no agrupa 3 cifras
  assert.strictEqual(core.num(1000000, 0), '1.000.000');
});

test('num maneja null/undefined/NaN y cero', () => {
  assert.strictEqual(core.num(null), '—');
  assert.strictEqual(core.num(undefined), '—');
  assert.strictEqual(core.num(NaN), '—');
  assert.strictEqual(core.num(0, 2), '0');
  assert.strictEqual(core.num(-1234.5, 2), '-1.234,5');
});

test('num(0.1 + 0.2, 2) no muestra basura de coma flotante', () => {
  // 0.1 + 0.2 = 0.30000000000000004; toFixed(2) lo deja en "0.30" -> "0,3"
  assert.strictEqual(core.num(0.1 + 0.2, 2), '0,3');
  assert.notStrictEqual(core.num(0.1 + 0.2, 2), '0,30000000000000004');
});

test('BUG: num(1.005, 2) debe redondear a "1,01", no a "1"', () => {
  // toFixed usa el binario: 1.005 es 1.004999... -> "1.00". El servidor
  // round() usa Number.EPSILON y sí devuelve 1.01. Divergencia front/servidor.
  assert.strictEqual(core.num(1.005, 2), '1,01');
});

test('BUG: num(1.335, 2) debe redondear a "1,34", no a "1,33"', () => {
  // 1.335 en binario es 1.334999... -> toFixed(2) = "1.33". Correcto: 1.34.
  assert.strictEqual(core.num(1.335, 2), '1,34');
});

/* ------------------------------------------------------------------ */
/* 2. eur / eur0 / pct                                                  */
/* ------------------------------------------------------------------ */

test('eur y eur0 redondean y muestran €', () => {
  assert.strictEqual(core.eur(1234.5), '1.234,50 €');
  assert.strictEqual(core.eur(0), '0,00 €');
  assert.strictEqual(core.eur(null), '—');
  assert.strictEqual(core.eur0(1234.5), '1.235 €'); // 1234.5 -> 1235
  assert.strictEqual(core.eur0(1234.4), '1.234 €');
});

test('pct antepone signo y usa num()', () => {
  assert.strictEqual(core.pct(2.5), '+2,5 %');
  assert.strictEqual(core.pct(-2.5), '-2,5 %');
  assert.strictEqual(core.pct(2.55), '+2,55 %');
  assert.strictEqual(core.pct(null), '—');
});

test('BUG: eur(1.005) debe ser "1,01 €", no "1,00 €"', () => {
  // Mismo origen que num(1.005): toFixed sin compensación de coma flotante.
  assert.strictEqual(core.eur(1.005), '1,01 €');
});

/* ------------------------------------------------------------------ */
/* 3. priceFmt: decimales por magnitud y precio < 0,01                  */
/* ------------------------------------------------------------------ */

test('priceFmt elige decimales por magnitud', () => {
  assert.match(core.priceFmt(0.005), /0,005000\s*€/);   // < 0.01 -> 6 dec
  assert.match(core.priceFmt(0.5), /0,5000\s*€/);        // < 1 -> 4 dec
  assert.match(core.priceFmt(0.01), /0,0100\s*€/);       // 0.01 no es < 0.01
  assert.match(core.priceFmt(5), /5,000\s*€/);           // < 100 -> 3 dec
  assert.match(core.priceFmt(1234.5), /1234,50\s*€/);    // >= 100 -> 2 dec
});

test('priceFmt no devuelve "0,00" para precios por debajo de 0,01', () => {
  assert.notStrictEqual(core.priceFmt(0.005), '0,00 €');
  assert.notStrictEqual(core.priceFmt(0.000001), '0,00 €');
  assert.match(core.priceFmt(0.000001), /0,000001\s*€/);
});

test('priceFmt devuelve "—" para no numéricos', () => {
  assert.strictEqual(core.priceFmt(null), '—');
  assert.strictEqual(core.priceFmt(NaN), '—');
  assert.strictEqual(core.priceFmt(undefined), '—');
});

/* ------------------------------------------------------------------ */
/* 4. signed / arrow / short                                           */
/* ------------------------------------------------------------------ */

test('signed y arrow clasifican el signo', () => {
  assert.strictEqual(core.signed(5), 'pos');
  assert.strictEqual(core.signed(-5), 'neg');
  assert.strictEqual(core.signed(0), 'pos'); // 0 se trata como >= 0
  assert.strictEqual(core.arrow(5), '▲');
  assert.strictEqual(core.arrow(-5), '▼');
});

test('short abrevia magnitudes', () => {
  assert.strictEqual(core.short(1234567), '1,2 M');
  assert.strictEqual(core.short(1500), '1,50 k');
  assert.strictEqual(core.short(999), '999');
  assert.strictEqual(core.short(NaN), '—');
});

/* ------------------------------------------------------------------ */
/* 5. rangeFmt: decimales por magnitud                                  */
/* ------------------------------------------------------------------ */

test('rangeFmt elige decimales según la magnitud', () => {
  assert.strictEqual(ranges.rangeFmt(0.0005), '0,0005'); // < 0.001 -> 6
  assert.strictEqual(ranges.rangeFmt(0.5), '0,5');       // < 1 -> 4
  assert.strictEqual(ranges.rangeFmt(5), '5');           // < 10 -> 3
  assert.strictEqual(ranges.rangeFmt(500), '500');       // < 1000 -> 2
  assert.match(ranges.rangeFmt(1234.5), /1\.?234,50\s*€/); // >= 1000 -> priceFmt
  assert.strictEqual(ranges.rangeFmt(-0.5), '-0,5');     // conserva el signo
  assert.strictEqual(ranges.rangeFmt(0), '—');
  assert.strictEqual(ranges.rangeFmt(null), '—');
});

/* ------------------------------------------------------------------ */
/* 6. simNumbers: escenario de precio sobre la cartera (exportable)     */
/* ------------------------------------------------------------------ */

test('simNumbers recalcula valor/pnl/peso de la cartera a un precio objetivo', () => {
  // Datos de cartera de ejemplo, verificados a mano.
  core.state.portfolio = {
    totalValue: 17000,
    cryptoValue: 15000,
    cash: 2000,
    invested: 10000,
    coins: [{
      symbol: 'BTC', amount: 0.5, price: 30000, value: 15000,
      invested: 10000, avgPrice: 20000, costKnown: true,
      onExchange: 0.5, inCold: 0,
    }],
  };
  sim.simState.symbol = 'BTC';
  sim.simState.price = 40000;

  const n = sim.simNumbers();

  assert.strictEqual(n.price, 40000);
  assert.strictEqual(n.newCoinValue, 20000);          // 0.5 * 40000
  assert.strictEqual(n.newCrypto, 20000);             // 15000 - 15000 + 20000
  assert.strictEqual(n.newTotal, 22000);              // 20000 + 2000
  assert.strictEqual(n.delta, 5000);                  // 22000 - 17000
  assert.strictEqual(n.newPnl, 10000);                // 20000 - 10000
  assert.ok(Math.abs(n.weight - 90.9090909090909) < 1e-9); // 20000/22000*100
  assert.strictEqual(n.vsAvg, 100);                   // (40000-20000)/20000*100
});

test('simNumbers con precio a la baja: pnl negativo y vsAvg negativo', () => {
  core.state.portfolio = {
    totalValue: 17000, cryptoValue: 15000, cash: 2000, invested: 10000,
    coins: [{
      symbol: 'BTC', amount: 0.5, price: 30000, value: 15000,
      invested: 10000, avgPrice: 20000, costKnown: true, onExchange: 0.5, inCold: 0,
    }],
  };
  sim.simState.symbol = 'BTC';
  sim.simState.price = 15000;

  const n = sim.simNumbers();
  assert.strictEqual(n.newCoinValue, 7500);
  assert.strictEqual(n.newPnl, 7500 - 10000); // -2500
  assert.strictEqual(n.vsAvg, -25);            // (15000-20000)/20000*100
});

test('simCoinObject devuelve una moneda en seguimiento sin posición', () => {
  core.state.portfolio = { coins: [] };
  sim.initSim({ getMercados: () => [{ symbol: 'ETH', price: 2000, change: 3.5 }] });
  const c = sim.simCoinObject('ETH');
  assert.strictEqual(c.symbol, 'ETH');
  assert.strictEqual(c.amount, 0);
  assert.strictEqual(c.price, 2000);
  assert.strictEqual(c.enCartera, false);
});
