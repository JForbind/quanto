'use strict';
// Auditoría de los cálculos de valor y P/L de la cartera.
// Casos numéricos verificados a mano contra analyze() y buildPortfolio().
// Ejecutar con: node --test tests/portfolio-audit.test.js
//
// Los tests marcados con "[BUG]" fallan a propósito: documentan un cálculo
// incorrecto. Los marcados con "[SOSPECHA]" fijan el comportamiento actual
// para dejar constancia del matiz (no fallan).
const test = require('node:test');
const assert = require('node:assert');

const { round } = require('../lib/util');
const { analyze } = require('../lib/history');
const { buildPortfolio } = require('../lib/portfolio');

function op(over) {
  return Object.assign({
    id: '', ts: Date.parse('2024-01-01T00:00:00Z'), type: 'buy', currency: 'BTC',
    amount: 1, quoteCurrency: 'EUR', quotePrice: 1000, paidCurrency: 'EUR',
    paidAmount: 1000, paidEur: 1000, fee: 0, feeCurrency: 'EUR', status: 'Completed',
  }, over);
}

function portfolioOf(opts) {
  return buildPortfolio(Object.assign({
    mode: 'live', balances: [], prices: {}, dayChange: {}, analysis: null,
    holdings: {}, overrides: {},
  }, opts));
}

// ------------------------------------------------------------------ valor total
test('valor total = cripto + efectivo; el efectivo se suma una sola vez', () => {
  const analysis = analyze([
    op({ id: 'b1', ts: 1, amount: 0.5, paidEur: 20000, paidAmount: 20000, fee: 10 }),
    op({ id: 'b2', ts: 2, currency: 'ETH', amount: 2, paidEur: 4000, paidAmount: 4000, quotePrice: 2000 }),
  ]);
  const p = portfolioOf({
    analysis,
    balances: [
      { symbol: 'BTC', available: '0.5', inOrder: '0' },
      { symbol: 'ETH', available: '2', inOrder: '0' },
      { symbol: 'EUR', available: '1000', inOrder: '0' },
    ],
    prices: { BTC: 40000, ETH: 3000 },
  });

  // BTC: 0.5 * 40000 = 20000 ; ETH: 2 * 3000 = 6000 ; cripto = 26000
  // efectivo = 1000 ; total = 27000
  assert.strictEqual(p.cryptoValue, 26000);
  assert.strictEqual(p.cash, 1000);
  assert.strictEqual(p.totalValue, 27000);
  assert.strictEqual(p.cryptoValue + p.cash, p.totalValue, 'cash contado una vez');

  // invertido: BTC 20000 + ETH 4000 = 24000
  // pnl: BTC 0 (comprado a 40000) + ETH 2000 (2 * (3000 - 2000)) = 2000 ; pnlPct = 8.33
  assert.strictEqual(p.invested, 24000);
  assert.strictEqual(p.pnl, 2000);
  assert.strictEqual(p.pnlPct, 8.33);
  assert.strictEqual(p.coinCount, 2);

  // la comisión (fee=10 EUR) ya va incluida en paidEur: no se duplica
  const btc = p.coins.find(c => c.symbol === 'BTC');
  assert.strictEqual(btc.invested, 20000, 'comisión no duplicada (paidEur ya la incluye)');
});

test('la wallet fría se separa del saldo del exchange sin duplicar', () => {
  const analysis = analyze([
    op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000 }),
    op({ id: 'w1', ts: 2, type: 'withdrawal', amount: 0.5, paidEur: 0, paidAmount: 0 }),
  ]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '0.5' }, { symbol: 'EUR', available: '500' }],
    prices: { BTC: 2000 },
  });
  const btc = p.coins[0];
  assert.strictEqual(btc.amount, 1);
  assert.strictEqual(btc.onExchange, 0.5);
  assert.strictEqual(btc.inCold, 0.5);
  assert.strictEqual(p.storage.exchangeValue, 1000); // 0.5 * 2000
  assert.strictEqual(p.storage.coldValue, 1000);     // 0.5 * 2000
  assert.strictEqual(p.cryptoValue, 2000);           // exchange + cold, sin duplicar
  assert.strictEqual(p.storage.exchangeValue + p.storage.coldValue, p.cryptoValue);
  assert.strictEqual(p.totalValue, 2500);            // 2000 + 500 cash
  assert.strictEqual(p.storage.coldPct, 40);         // 1000 / 2500
  assert.strictEqual(p.storage.exchangePct, 40);
});

// ------------------------------------------------------------------ P/L no realizado
test('P/L usa el coste medio correcto (coste total / cantidad) sin ventas', () => {
  const analysis = analyze([
    op({ id: 'b1', ts: 1, amount: 0.5, paidEur: 10000, paidAmount: 10000, quotePrice: 20000 }),
    op({ id: 'b2', ts: 2, amount: 0.5, paidEur: 15000, paidAmount: 15000, quotePrice: 30000 }),
  ]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '1' }],
    prices: { BTC: 40000 },
  });
  // coste total = 25000 sobre 1 BTC → coste medio 25000
  assert.strictEqual(round(analysis.byCoin.BTC.avgCost, 2), 25000);
  assert.strictEqual(p.coins[0].avgPrice, 25000);
  assert.strictEqual(p.invested, 25000);
  assert.strictEqual(p.pnl, 15000);       // 40000 - 25000
  assert.strictEqual(p.pnlPct, 60);
});

test('las monedas sin coste conocido se excluyen del P/L y del invertido', () => {
  const p = portfolioOf({
    balances: [{ symbol: 'BTC', available: '1' }, { symbol: 'XRP', available: '1000' }],
    prices: { BTC: 2000, XRP: 1 },
  });
  assert.strictEqual(p.totalValue, 3000);   // el valor SÍ se cuenta
  assert.strictEqual(p.invested, 0);
  assert.strictEqual(p.pnl, 0);
  assert.strictEqual(p.pnlPct, null);
  assert.ok(p.coins.every(c => c.costKnown === false));
  assert.ok(p.warnings.some(w => w.code === 'no-cost'));
});

// ------------------------------------------------------------------ día / hoy
test('dayChangeValue y dayChangePct usan precio y cierre anterior correctos', () => {
  const analysis = analyze([op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000 })]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '1' }, { symbol: 'EUR', available: '2000' }],
    prices: { BTC: 2000 },
    dayChange: { BTC: 25 },   // (last - open)/open = 25 %  →  open = 2000/1.25 = 1600
  });
  // variación del día = 1 * (2000 - 1600) = 400
  assert.strictEqual(p.dayChangeValue, 400);
  // % sobre el total (incluye efectivo): 400 / 4000 = 10 %
  assert.strictEqual(p.dayChangePct, 10);
  // valor de la moneda se calcula con el precio actual (last), no con el open
  assert.strictEqual(p.coins[0].value, 2000);
});

// ------------------------------------------------------------------ invertido tras ventas
// [BUG] Tras vender y recomprar, g.cost/g.bought NO es el coste medio restante:
//       analyze() calcula el realizado con media móvil, pero buildPortfolio()
//       reconstruye el invertido con media ponderada (coste total / total comprado),
//       que ignora que la venta ya se restó. Ambos métodos son incoherentes entre sí.
test('[BUG] invertido tras vender y recomprar debe ser la base restante (media móvil)', () => {
  const analysis = analyze([
    op({ id: 'b1', ts: 1, amount: 2, paidEur: 200, paidAmount: 200, quotePrice: 100 }),
    op({ id: 's1', ts: 2, type: 'sell', amount: 1, paidEur: 150, paidAmount: 150, quotePrice: 150 }),
    op({ id: 'b2', ts: 3, amount: 1, paidEur: 400, paidAmount: 400, quotePrice: 400 }),
  ]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '2' }],
    prices: { BTC: 500 },
  });

  // Realizado correcto (media móvil): 1 * (150 - 100) = 50
  assert.strictEqual(analysis.realized.total, 50);

  // Base restante correcta = coste total (600) - coste vendido (100) = 500
  // El código devuelve 400 (media ponderada 200 * 2). FALLA: demuestra el bug.
  assert.strictEqual(p.invested, 500, 'base restante = 600 - 100 = 500');
  assert.strictEqual(p.pnl, 1000 - 500, 'pnl = valor - base restante');
});

test('[BUG] tras liquidar todo y recomprar, el coste medio no puede promediar la venta', () => {
  const analysis = analyze([
    op({ id: 'b1', ts: 1, amount: 1, paidEur: 100, paidAmount: 100, quotePrice: 100 }),
    op({ id: 's1', ts: 2, type: 'sell', amount: 1, paidEur: 120, paidAmount: 120, quotePrice: 120 }),
    op({ id: 'b2', ts: 3, amount: 1, paidEur: 300, paidAmount: 300, quotePrice: 300 }),
  ]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '1' }],
    prices: { BTC: 400 },
  });
  // Solo queda 1 BTC comprado a 300 → base restante = 300
  // El código devuelve 200 (coste total 400 / 2 compras * 1). FALLA.
  assert.strictEqual(p.invested, 300, 'base restante = 300 (solo queda la compra de 300)');
});

// ------------------------------------------------------------------ pendingAmount
test('detecta compras nuevas no importadas (aviso "coste estimado")', () => {
  const analysis = analyze([op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000 })]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '1.5' }],
    prices: { BTC: 2000 },
  });
  const btc = p.coins[0];
  assert.strictEqual(btc.amount, 1.5);
  assert.strictEqual(btc.pendingAmount, 0.5);
  assert.strictEqual(btc.source, 'estimado');
  assert.strictEqual(btc.invested, 1500);   // coste medio 1000 * 1.5
  assert.ok(p.warnings.some(w => w.code === 'pending'));
});

// [SOSPECHA] La detección solo mira "onExchange - histOnEx > 0". Una VENTA
// nueva (no importada) deja el saldo por debajo del historial, pendingAmount=0
// y el código atribuye la diferencia a "wallet fría" en lugar de a la venta.
test('[SOSPECHA] una venta no importada se disfraza de wallet fría', () => {
  const analysis = analyze([op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000 })]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '0.5' }, { symbol: 'EUR', available: '950' }],
    prices: { BTC: 2000 },
  });
  const btc = p.coins[0];
  assert.strictEqual(btc.pendingAmount, 0, 'no detecta el desajuste por debajo');
  assert.strictEqual(btc.amount, 1, 'sigue contando la moneda como si la tuvieras');
  assert.strictEqual(btc.inCold, 0.5, 'la venta aparece como wallet fría');
  assert.ok(!p.warnings.some(w => w.code === 'pending'), 'sin aviso');
});

// ------------------------------------------------------------------ redondeo y reparto
test('redondeo a 2 decimales y reparto (allocationPct / share) coherente', () => {
  const p = portfolioOf({
    balances: [
      { symbol: 'BTC', available: '1' },
      { symbol: 'ETH', available: '2' },
      { symbol: 'EUR', available: '5000' },
    ],
    prices: { BTC: 10000, ETH: 2500 },
  });
  // cripto = 10000 + 5000 = 15000 ; total = 20000
  assert.strictEqual(p.cryptoValue, 15000);
  assert.strictEqual(p.totalValue, 20000);

  const btc = p.coins.find(c => c.symbol === 'BTC');
  const eth = p.coins.find(c => c.symbol === 'ETH');
  assert.strictEqual(btc.value, 10000);
  assert.strictEqual(eth.value, 5000);

  // share sobre cripto suma ~100
  assert.ok(Math.abs(btc.share + eth.share - 100) < 0.01, `share suma ${btc.share + eth.share}`);
  // allocationPct es sobre el total (incluye cash) → suma < 100 cuando hay efectivo
  assert.strictEqual(btc.allocationPct, 50);
  assert.strictEqual(eth.allocationPct, 25);
  assert.ok(Math.abs(btc.allocationPct + eth.allocationPct - 75) < 0.01,
    'allocationPct excluye el efectivo (50 + 25 = 75, no 100)');
});

// ------------------------------------------------------------------ evoluciones
test('los precios EUR se redondean a 2 decimales en valor/invertido/pnl', () => {
  const analysis = analyze([
    op({ id: 'b1', ts: 1, amount: 1, paidEur: 333.33, paidAmount: 333.33, quotePrice: 333.33 }),
  ]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '1' }],
    prices: { BTC: 500.555 },
  });
  const btc = p.coins[0];
  assert.strictEqual(btc.value, round(500.555, 2));
  assert.strictEqual(btc.invested, 333.33);
  assert.strictEqual(btc.pnl, round(500.555 - 333.33, 2));
});
