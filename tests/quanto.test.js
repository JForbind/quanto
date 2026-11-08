'use strict';
// Pruebas de la lógica de Quanto (sin red y sin servidor).
// Ejecutar con:  npm test   (o  node --test tests/)
const test = require('node:test');
const assert = require('node:assert');

const { parseNumber, parseTimestamp, round } = require('../lib/util');
const { parseBitvavoHistory } = require('../lib/csv');
const { mergeOps, analyze, opFromAccountHistory, fingerprint } = require('../lib/history');
const { taxReport, simulateSale, estimateTax } = require('../lib/tax');
const { buildPortfolio, demoPortfolio, demoOps, demoEvolution } = require('../lib/portfolio');
const { evolutionSeries } = require('../lib/evolution');
const auth = require('../lib/auth');
const { classify } = require('../lib/feargreed');

// ---------------------------------------------------------------- utilidades
test('parseNumber acepta formato español, inglés y espacios', () => {
  assert.strictEqual(parseNumber('1.234,56'), 1234.56);
  assert.strictEqual(parseNumber('1,234.56'), 1234.56);
  assert.strictEqual(parseNumber('0,05'), 0.05);
  assert.strictEqual(parseNumber('1 234,5'), 1234.5);
  assert.strictEqual(parseNumber('1.234'), 1.234); // Bitvavo usa el punto como decimal
  assert.strictEqual(parseNumber('1.234.567'), 1234567); // dos puntos: miles
  assert.strictEqual(parseNumber(''), 0);
  assert.strictEqual(parseNumber(null), 0);
  assert.strictEqual(parseNumber('12,5 €'), 12.5);
});

test('parseTimestamp entiende ISO y día-primero', () => {
  assert.strictEqual(parseTimestamp('2023-01-10', '10:00:00'), Date.parse('2023-01-10T10:00:00Z'));
  assert.strictEqual(parseTimestamp('10-01-2023', '10:00'), Date.parse('2023-01-10T10:00:00Z'));
  assert.strictEqual(parseTimestamp('30-12-2024', '23:59:59'), Date.parse('2024-12-30T23:59:59Z'));
  assert.strictEqual(parseTimestamp('', ''), 0);
});

// ---------------------------------------------------------------- CSV
const CSV_COMMA_DECIMALS = [
  'Transaction id;Date;Time;Type;Currency;Amount;Quote currency;Quote price;Received / paid currency;Received / paid amount;Fee amount;Fee currency;Status;Address',
  'tx1;10-01-2023;10:00:00;buy;BTC;0,5;EUR;20.000,00;EUR;10.000,00;10,00;EUR;Completed;',
  'tx2;10-03-2023;10:00:00;buy;BTC;0,5;EUR;30.000,00;EUR;15.000,00;10,00;EUR;Completed;',
  'tx3;01-05-2024;12:00:00;sell;BTC;0,25;EUR;40.000,00;EUR;10.000,00;10,00;EUR;Completed;',
  'tx4;01-02-2023;09:00:00;deposit;EUR;5.000,00;;;;;0;;Completed;',
  'tx5;01-06-2024;09:00:00;withdrawal;BTC;0,1;;;;;0,0001;BTC;Completed;bc1xyz',
].join('\n');

test('parseBitvavoHistory lee CSV con ; y decimales de coma', () => {
  const ops = parseBitvavoHistory(CSV_COMMA_DECIMALS);
  assert.strictEqual(ops.length, 5);
  assert.deepStrictEqual(ops.map(o => o.type), ['buy', 'buy', 'sell', 'deposit', 'withdrawal']);
  assert.strictEqual(ops[0].amount, 0.5);
  assert.strictEqual(ops[0].paidEur, 10000);
  assert.strictEqual(ops[0].ts, Date.parse('2023-01-10T10:00:00Z'));
  assert.strictEqual(ops[2].paidEur, 10000);
  assert.strictEqual(ops[4].fee, 0.0001);
});

test('parseBitvavoHistory ignora ficheros ajenos', () => {
  assert.deepStrictEqual(parseBitvavoHistory('Name,Price,Amount\nBitcoin,1,2'), []);
  assert.deepStrictEqual(parseBitvavoHistory(''), []);
});

test('parseBitvavoHistory respeta comas dentro de comillas', () => {
  const csv = [
    'Type,Currency,Amount,Quote currency,Quote price,Received / paid currency,Received / paid amount,Fee amount,Fee currency,Status,Transaction id,Address,Date,Time',
    'buy,"BTC",0.5,EUR,20000,EUR,10000,1,EUR,Completed,id1,"calle, 1",2023-01-10,10:00:00',
  ].join('\n');
  const ops = parseBitvavoHistory(csv);
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].address, 'calle, 1');
});

// ---------------------------------------------------------------- fusión
function op(over) {
  return Object.assign({
    id: '', ts: Date.parse('2024-01-01T00:00:00Z'), type: 'buy', currency: 'BTC',
    amount: 1, quoteCurrency: 'EUR', quotePrice: 1000, paidCurrency: 'EUR',
    paidAmount: 1000, paidEur: 1000, fee: 0, feeCurrency: 'EUR', status: 'Completed',
  }, over);
}

test('mergeOps no duplica por id', () => {
  const a = [op({ id: 'x1' })];
  const r = mergeOps(a, [op({ id: 'x1' })]);
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.added, 0);
});

test('mergeOps no duplica la misma operación si el id cambia', () => {
  const a = [op({ id: 'csv-1' })];
  const r = mergeOps(a, [op({ id: '', source: 'api' })]);
  assert.strictEqual(r.ops.length, 1, 'la huella debe coincidir');
  assert.strictEqual(r.added, 0);
});

test('mergeOps añade operaciones nuevas y enriquece las incompletas', () => {
  const a = [op({ id: 'x1', fee: 0, feeCurrency: '', quotePrice: 0 })];
  const r = mergeOps(a, [op({ id: 'x2', ts: Date.parse('2024-02-01T00:00:00Z'), currency: 'ETH' }), op({ id: 'x1', fee: 2, feeCurrency: 'EUR', quotePrice: 1000 })]);
  assert.strictEqual(r.ops.length, 2);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.enriched, 1);
  assert.strictEqual(r.ops.find(o => o.id === 'x1').fee, 2);
  assert.ok(r.ops[0].ts <= r.ops[1].ts, 'ordenado por fecha');
});

test('opFromAccountHistory normaliza la respuesta de la API', () => {
  const a = opFromAccountHistory({
    type: 'buy', transactionId: 'api-1', executedAt: '2024-03-01T10:00:00Z',
    sentCurrency: 'EUR', sentAmount: 100, receivedCurrency: 'BTC', receivedAmount: 0.001,
    priceCurrency: 'EUR', priceAmount: 100000, feesAmount: 0.25, feesCurrency: 'EUR',
  });
  assert.strictEqual(a.currency, 'BTC');
  assert.strictEqual(a.amount, 0.001);
  assert.strictEqual(a.paidEur, 100);
  assert.strictEqual(a.fee, 0.25);
  const w = opFromAccountHistory({ type: 'withdrawal', sentCurrency: 'BTC', sentAmount: 0.5, transactionId: 'w1' });
  assert.strictEqual(w.currency, 'BTC');
  assert.strictEqual(w.amount, 0.5);
});

// ---------------------------------------------------------------- coste medio
test('analyze calcula coste medio, realizado y patrimonio', () => {
  const ops = parseBitvavoHistory(CSV_COMMA_DECIMALS);
  const st = analyze(ops);
  assert.strictEqual(round(st.byCoin.BTC.avgCost, 2), 25000);
  assert.strictEqual(st.byCoin.BTC.amount, 0.75);
  assert.strictEqual(st.realized.total, 3750);
  assert.strictEqual(st.totals.depositsEur, 5000);
  assert.strictEqual(st.totals.sells, 1);
  assert.strictEqual(st.totals.buys, 2);
});

test('analyze no inventa beneficio si vendes sin compra registrada', () => {
  const ops = [
    op({ id: 'd1', type: 'deposit', currency: 'BTC', amount: 1, paidEur: 0, paidAmount: 0 }),
    op({ id: 's1', type: 'sell', amount: 1, paidEur: 40000, paidAmount: 40000, quotePrice: 40000 }),
  ];
  const st = analyze(ops);
  assert.strictEqual(st.realized.total, 0, 'sin coste no hay beneficio calculable');
  assert.strictEqual(st.realized.unmatchedProceeds, 40000);
  assert.strictEqual(st.byCoin.BTC.unmatchedSold, 1);
});

// ---------------------------------------------------------------- fiscal
test('taxReport aplica FIFO por lotes', () => {
  const ops = parseBitvavoHistory(CSV_COMMA_DECIMALS);
  const rep = taxReport(ops);
  assert.strictEqual(rep.disposals.length, 1);
  const d = rep.disposals[0];
  assert.strictEqual(d.symbol, 'BTC');
  assert.strictEqual(d.amount, 0.25);
  assert.strictEqual(d.cost, 5000);
  assert.strictEqual(d.proceeds, 10000);
  assert.strictEqual(d.gain, 5000);
  assert.strictEqual(d.lots.length, 1);
  assert.strictEqual(new Date(d.lots[0].ts).toISOString().slice(0, 10), '2023-01-10');
  assert.strictEqual(rep.years[0].year, 2024);
  assert.strictEqual(rep.years[0].tax, 950);
  assert.strictEqual(round(rep.inventory.BTC.amount, 8), 0.75);
});

test('taxReport marca transmisiones sin lote', () => {
  const ops = [
    op({ id: 'd1', type: 'deposit', currency: 'BTC', amount: 1, paidEur: 0, paidAmount: 0 }),
    op({ id: 's1', type: 'sell', amount: 1, paidEur: 40000, paidAmount: 40000 }),
  ];
  const rep = taxReport(ops);
  assert.strictEqual(rep.disposals[0].unmatchedAmount, 1);
  assert.strictEqual(rep.disposals[0].gain, 0);
  assert.strictEqual(rep.totals.unmatchedProceeds, 40000);
  assert.ok(rep.years[0].incomplete);
});

test('estimateTax usa los tramos de la base del ahorro', () => {
  assert.strictEqual(estimateTax(6000), 1140);
  assert.strictEqual(estimateTax(50000), 10380);
  assert.strictEqual(estimateTax(100000), 21880);
  assert.strictEqual(estimateTax(0), 0);
  assert.strictEqual(estimateTax(-100), 0);
});

test('simulateSale separa la parte casada y la que no', () => {
  const ops = parseBitvavoHistory(CSV_COMMA_DECIMALS);
  const sim = simulateSale(ops, 'BTC', 0.5);
  assert.strictEqual(sim.available, 0.75);
  assert.strictEqual(sim.matchedAmount, 0.5);
  assert.strictEqual(sim.fifoCost, 12500); // 0,25@20000 + 0,25@30000
  const over = simulateSale(ops, 'BTC', 5);
  assert.strictEqual(over.unmatchedAmount, 4.25);
});

// ---------------------------------------------------------------- cartera
function portfolioOf(opts) {
  return buildPortfolio(Object.assign({
    mode: 'live', balances: [], prices: {}, dayChange: {}, analysis: null,
    holdings: {}, overrides: {},
  }, opts));
}

test('buildPortfolio no cuenta el efectivo como beneficio', () => {
  const analysis = analyze([op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000, quotePrice: 1000 })]);
  const p = portfolioOf({
    analysis,
    balances: [{ symbol: 'BTC', available: '1', inOrder: '0' }, { symbol: 'EUR', available: '500', inOrder: '0' }],
    prices: { BTC: 2000 },
  });
  assert.strictEqual(p.totalValue, 2500);
  assert.strictEqual(p.cash, 500);
  assert.strictEqual(p.cryptoValue, 2000);
  assert.strictEqual(p.invested, 1000);
  assert.strictEqual(p.pnl, 1000, 'el efectivo no infla el P/L');
});

test('buildPortfolio excluye del P/L las monedas sin coste', () => {
  const p = portfolioOf({
    balances: [{ symbol: 'BTC', available: '1' }, { symbol: 'XRP', available: '1000' }],
    prices: { BTC: 2000, XRP: 1 },
  });
  assert.strictEqual(p.coins.length, 2);
  assert.strictEqual(p.invested, 0);
  assert.strictEqual(p.pnl, 0);
  assert.ok(p.warnings.some(w => w.code === 'no-cost'));
});

test('buildPortfolio reparte exchange y wallet fría según el historial', () => {
  const analysis = analyze([
    op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000 }),
    op({ id: 'w1', ts: 2, type: 'withdrawal', amount: 0.5, paidEur: 0, paidAmount: 0 }),
  ]);
  const p = portfolioOf({ analysis, balances: [{ symbol: 'BTC', available: '0.5' }], prices: { BTC: 2000 } });
  const btc = p.coins[0];
  assert.strictEqual(btc.amount, 1);
  assert.strictEqual(btc.onExchange, 0.5);
  assert.strictEqual(btc.inCold, 0.5);
  assert.strictEqual(p.storage.coldValue, 1000);
  assert.strictEqual(p.storage.exchangeValue, 1000);
});

test('buildPortfolio detecta compras nuevas que no están en el historial', () => {
  const analysis = analyze([op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000 })]);
  const p = portfolioOf({ analysis, balances: [{ symbol: 'BTC', available: '1.5' }], prices: { BTC: 2000 } });
  assert.strictEqual(p.coins[0].amount, 1.5);
  assert.strictEqual(p.coins[0].pendingAmount, 0.5);
  assert.ok(p.warnings.some(w => w.code === 'pending'));
});

test('buildPortfolio respeta los ajustes manuales de inversión', () => {
  const analysis = analyze([op({ id: 'b1', ts: 1, amount: 1, paidEur: 1000, paidAmount: 1000 })]);
  const p = portfolioOf({ analysis, balances: [{ symbol: 'BTC', available: '1' }], prices: { BTC: 2000 }, overrides: { BTC: 500 } });
  assert.strictEqual(p.coins[0].invested, 500);
  assert.strictEqual(p.coins[0].source, 'manual');
  assert.strictEqual(p.pnl, 1500);
});

test('el modo demo genera una cartera y una evolución coherentes', () => {
  const prices = { BTC: 60000, ETH: 2000, SOL: 100, XRP: 1, ADA: 0.2, DOT: 1, MATIC: 0.4 };
  const p = demoPortfolio(prices, {});
  assert.ok(p.coins.length >= 5);
  assert.ok(p.totalValue > 0);
  assert.ok(p.warnings.some(w => w.code === 'demo'));
  const evo = demoEvolution(prices);
  assert.ok(evo.length > 100);
  assert.ok(evo[evo.length - 1].value > 0);
});

// ---------------------------------------------------------------- evolución
test('evolutionSeries valora la cartera día a día', () => {
  const ops = [op({ id: 'b1', ts: Date.parse('2024-01-01T00:00:00Z'), amount: 1, paidEur: 100, paidAmount: 100, quotePrice: 100 })];
  const series = evolutionSeries(ops, {
    BTC: [
      { t: Date.parse('2024-01-01T00:00:00Z'), close: 100 },
      { t: Date.parse('2024-01-02T00:00:00Z'), close: 200 },
    ],
  }, { until: '2024-01-03T00:00:00Z' });
  assert.strictEqual(series.length, 3);
  assert.strictEqual(series[0].value, 100);
  assert.strictEqual(series[series.length - 1].value, 200);
  assert.strictEqual(series[series.length - 1].invested, 100);
});

// ---------------------------------------------------------------- seguridad
test('hashPassword/verifyPassword funcionan y no aceptan otra clave', () => {
  const stored = auth.hashPassword('secreto-123');
  assert.ok(auth.verifyPassword('secreto-123', stored));
  assert.ok(!auth.verifyPassword('otra', stored));
  assert.ok(!auth.verifyPassword('', stored));
  assert.notStrictEqual(stored.hash, 'secreto-123');
});

test('los tokens de sesión caducan y no se pueden falsificar', () => {
  const secret = 'x'.repeat(64);
  const token = auth.createToken(secret, 1000 * 60);
  assert.ok(auth.verifyToken(secret, token));
  // alterar el último carácter garantizando que el token cambia (si ya era '0', usar '1')
  const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
  assert.notStrictEqual(tampered, token);
  assert.ok(!auth.verifyToken(secret, tampered));
  assert.ok(!auth.verifyToken('otro', token));
  const expired = auth.createToken(secret, -1000);
  assert.ok(!auth.verifyToken(secret, expired));
});

// ---------------------------------------------------------------- miedo/codicia
test('el índice se clasifica por tramos', () => {
  assert.strictEqual(classify(0).key, 'extreme-fear');
  assert.strictEqual(classify(24).key, 'extreme-fear');
  assert.strictEqual(classify(25).key, 'fear');
  assert.strictEqual(classify(50).key, 'neutral');
  assert.strictEqual(classify(60).key, 'greed');
  assert.strictEqual(classify(100).key, 'extreme-greed');
});
