'use strict';
// Auditoría de los cálculos de rendimiento y riesgo de Quanto.
// Casos numéricos verificados a mano (TWR con flujos externos, sizing, reality, coherencia).
// Ejecutar:  node --test tests/twr-audit.test.js
//
// No toca código de producción: solo comprueba y documenta hallazgos.

const test = require('node:test');
const assert = require('node:assert');

const { computeTwr, tradeFlows, dayKey } = require('../lib/twr');
const { stdev } = require('../lib/indicators');
const { sizePortfolio, invert } = require('../lib/sizing');
const { realityCheck, positionsFor, binomP, STRATEGIES } = require('../lib/reality');
const coherence = require('../lib/coherence');

const D = (n) => Date.UTC(2026, 0, n); // 1..31 de enero de 2026 (mediodías UTC)
const serie = (vals, startDay = 1) => ({
  points: vals.map((v, i) => ({ t: D(startDay + i), value: v })),
  ops: [],
});
const aprox = (got, want, tol = 1e-9) => assert.ok(Math.abs(got - want) < tol, `esperado ${want}, obtenido ${got}`);

// ------------------------------------------------------------------ TWR

test('TWR sin flujos = variación simple del valor', () => {
  const r = computeTwr(serie([1000, 1100, 1210]));
  assert.strictEqual(r.ok, true);
  aprox(r.total, 0.21); // 1210/1000 - 1
});

test('TWR: un depósito a mitad de serie no cuenta como rendimiento', () => {
  // 1000 € (día 1) → mercado +10 % (1100) → deposito 1000 (2100) → plano (día 3).
  // Rendimiento real: solo el +10 % del mercado.
  const input = serie([1000, 2100, 2100]);
  input.ops = [{ type: 'buy', ts: D(2), paidEur: 1000 }];
  const r = computeTwr(input);
  aprox(r.total, 0.10, 1e-9);
  assert.strictEqual(r.flows, 1000);
});

test('TWR: un retiro a mitad de serie no cuenta como pérdida', () => {
  // 2000 € (día 1) → mercado -10 % (1800) → retiro 1000 (800) → plano (día 3).
  // Rendimiento real: solo el -10 % del mercado.
  const input = serie([2000, 800, 800]);
  input.ops = [{ type: 'sell', ts: D(2), paidEur: 1000 }];
  const r = computeTwr(input);
  aprox(r.total, -0.10, 1e-9);
  assert.strictEqual(r.flows, -1000);
});

test('TWR: depósito y subida de mercado el mismo día se separan bien', () => {
  // día1 1000 → día2: +20 % del mercado (1200) + depósito 800 = 2000 → día3 plano 2000.
  const input = serie([1000, 2000, 2000]);
  input.ops = [{ type: 'buy', ts: D(2), paidEur: 800 }];
  const r = computeTwr(input);
  aprox(r.total, 0.20, 1e-9); // (2000-800)/1000 - 1
});

test('TWR: enlaza periodos multiplicativamente (encadenado)', () => {
  // +10 % el primer tramo y +10 % el segundo → (1.1)(1.1)-1 = 0.21
  const r = computeTwr(serie([1000, 1100, 1210]));
  aprox(r.total, 0.21, 1e-9);
  // +10 % y -10 % → 0.99 - 1 = -0.01 (no -0.0 por media aritmética)
  const r2 = computeTwr(serie([1000, 1100, 990]));
  aprox(r2.total, -0.01, 1e-9);
});

test('TWR: anualización consistente con el número de días', () => {
  // 1 día, +10 % → (1.1)^365 - 1
  const a = computeTwr(serie([1000, 1100]));
  assert.strictEqual(a.days, 1);
  assert.ok(Math.abs(a.annual - (Math.pow(1.1, 365) - 1)) / (Math.pow(1.1, 365) - 1) < 1e-9);
  // 3 días, +10 % cada uno → total 33.1 %, anual = 1.331^(365/3) - 1
  const b = computeTwr(serie([1000, 1100, 1210, 1331]));
  aprox(b.total, 0.331, 1e-9);
  assert.strictEqual(b.days, 3);
  const esperado = Math.pow(1.331, 365 / 3) - 1;
  assert.ok(Math.abs(b.annual - esperado) / esperado < 1e-9);
  // serie plana → anual 0
  const c = computeTwr(serie([1000, 1000, 1000]));
  assert.strictEqual(c.total, 0);
  assert.strictEqual(c.annual, 0);
});

test('TWR: benchmark BTC y diferencia', () => {
  const input = serie([1000, 1100, 1200]);
  input.btc = [{ t: D(1), close: 100 }, { t: D(2), close: 110 }, { t: D(3), close: 130 }];
  const r = computeTwr(input);
  aprox(r.benchmark, 0.30);
  aprox(r.diff, r.total - 0.30);
});

test('TWR: ventana `days` no incluye flujos anteriores al inicio de la ventana', () => {
  // depósito de 1000 el día 1; ventana de 1 día solo mira día 2→3.
  const input = serie([1000, 2000, 2100]);
  input.ops = [{ type: 'buy', ts: D(1), paidEur: 1000 }];
  const r = computeTwr({ ...input, days: 1 });
  aprox(r.total, 2100 / 2000 - 1, 1e-9);
  assert.strictEqual(r.flows, 0); // el flujo del día 1 queda fuera de la ventana
});

test('tradeFlows: netea compras y ventas del mismo día e ignora otros tipos', () => {
  const f = tradeFlows([
    { type: 'buy', ts: D(3), paidEur: 500 },
    { type: 'sell', ts: D(3), paidEur: 200 },
    { type: 'deposit', ts: D(3), amount: 9999 },
    { type: 'withdrawal', ts: D(3), amount: 9999 },
    { type: 'reward', ts: D(3), amount: 1 },
  ]);
  assert.strictEqual(f.get(D(3)), 300);
  assert.strictEqual(f.size, 1);
});

test('TWR: seguridad ante división por cero, NaN y series vacías', () => {
  assert.strictEqual(computeTwr({ points: [] }).ok, false);
  assert.strictEqual(computeTwr({ points: [{ t: D(1), value: 100 }] }).ok, false);
  // un valor 0 en `prev` se salta sin propagar NaN
  const r = computeTwr(serie([1000, 0, 100]));
  assert.strictEqual(r.ok, true);
  assert.ok(Number.isFinite(r.total), 'total debe ser finito: ' + r.total);
  // valor negativo en `prev` se salta sin NaN
  const r2 = computeTwr(serie([-100, 100, 110]));
  assert.strictEqual(r2.ok, true);
  assert.ok(Number.isFinite(r2.total));
});

// ------------------------------------------------------------ HALLAZGO (BUG latente)
// Un flujo que cae en un día SIN punto de la serie se ignora en la fórmula,
// pero se cuenta en `flows`. Con puntos dispersos distorsiona el rendimiento.
test('BUG documentado: flujo en un día sin punto distorsiona el TWR', () => {
  // 1000 € (día 1) → depósito 1000 € el día 3 (sin punto) → 2000 € (día 5). Mercado plano.
  // TWR real: 0 %. Código: +100 % porque el flujo del día 3 no se resta.
  const input = {
    points: [{ t: D(1), value: 1000 }, { t: D(5), value: 2000 }],
    ops: [{ type: 'buy', ts: D(3), paidEur: 1000 }],
  };
  const r = computeTwr(input);
  // Lo correcto sería 0; el código devuelve 1.
  assert.strictEqual(r.total, 0, `flujo sin punto distorsiona: total=${r.total} (debería ser 0)`);
});

// ------------------------------------------------------------------ Sizing

test('stdev usa la muestra (denominador n-1)', () => {
  const s = stdev([2, 4, 4, 4, 5, 5, 7, 9], 8);
  aprox(s, Math.sqrt(32 / 7), 1e-12); // media 5, Σ(x-μ)² = 32
});

test('invert resuelve e invierte correctamente; matriz singular → null', () => {
  const inv = invert([[2, 0], [0, 4]]);
  aprox(inv[0][0], 0.5, 1e-12);
  aprox(inv[1][1], 0.25, 1e-12);
  assert.strictEqual(invert([[1, 1], [1, 1]]), null);
});

test('sizing: los pesos suman 1 (incluido efectivo) y el tope se respeta cuando es posible', () => {
  const serieRet = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const rets = {
    AAA: serieRet(160, i => Math.sin(i * 2.1) * 0.01),
    BBB: serieRet(160, i => Math.sin(i * 2.7) * 0.03),
    CCC: serieRet(160, i => Math.sin(i * 3.3) * 0.05),
  };
  const out = sizePortfolio([
    { symbol: 'AAA', value: 5000 },
    { symbol: 'BBB', value: 3000 },
    { symbol: 'CCC', value: 2000 },
  ], rets, { maxWeight: 0.35 });
  assert.strictEqual(out.ok, true);
  const suma = out.rows.reduce((a, r) => a + r.target, 0);
  aprox(suma, 1);
  for (const r of out.rows) assert.ok(r.target <= 0.35 + 1e-6, r.symbol + ' pasa del tope');
});

test('sizing: la moneda menos volátil pesa más (mínima varianza)', () => {
  const serieRet = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const rets = {
    CALM: serieRet(160, i => Math.sin(i * 1.7) * 0.005),
    VOLA: serieRet(160, i => Math.sin(i * 4.1) * 0.06),
  };
  const out = sizePortfolio([{ symbol: 'CALM', value: 5000 }, { symbol: 'VOLA', value: 5000 }], rets, { maxWeight: 0.9 });
  const calma = out.rows.find(r => r.symbol === 'CALM');
  const vola = out.rows.find(r => r.symbol === 'VOLA');
  assert.ok(calma.target > vola.target);
  assert.ok(calma.vol < vola.vol); // vol = desv.típica diaria × √365 (unidades coherentes)
});

test('sizing: el efectivo (stablecoin) no entra en el reparto por riesgo', () => {
  const serieRet = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const rets = {
    BTC: serieRet(160, i => Math.sin(i * 2.1) * 0.03),
    ETH: serieRet(160, i => Math.sin(i * 2.7) * 0.04),
    USDC: serieRet(160, () => 0),
  };
  const out = sizePortfolio([
    { symbol: 'BTC', value: 6000 },
    { symbol: 'ETH', value: 3000 },
    { symbol: 'USDC', value: 1000 },
  ], rets, { maxWeight: 0.5 });
  const usdc = out.rows.find(r => r.symbol === 'USDC');
  aprox(usdc.target, 0.1);
  assert.strictEqual(usdc.delta, 0);
  aprox(out.rows.reduce((a, r) => a + r.target, 0), 1);
});

// ------------------------------------------------- HALLAZGO (SOSPECHA): tope relajado sin aviso
test('sizing: con muchas monedas el tope máximo se relaja silenciosamente', () => {
  // 8 monedas y maxWeight 0.10 → n×cap < 100 %, el código sube el tope a 1/n = 12.5 %
  // sin avisar de que no respeta el máximo pedido.
  const serieRet = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const rets = {}; const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  names.forEach((s, i) => { rets[s] = serieRet(160, k => Math.sin(k * 2.1 + i * 0.7) * 0.02); });
  const out = sizePortfolio(names.map(s => ({ symbol: s, value: 1000 })), rets, { maxWeight: 0.10, minWeight: 0.05 });
  const mx = Math.max(...out.rows.map(r => r.target));
  // Documenta el comportamiento actual (12.5 %), que supera el 10 % pedido.
  assert.ok(mx > 0.10 + 1e-6, 'tope relajado: max=' + mx);
});

// ------------------------------------------------------------------ Reality

test('binomP: 50 % no es significativo; 60 % sí; n=0 → null', () => {
  assert.ok(binomP(500, 1000) > 0.9);
  assert.ok(binomP(600, 1000) < 0.001);
  assert.strictEqual(binomP(0, 0), null);
});

test('positionsFor: sin look-ahead (calentamiento y primera señal)', () => {
  const closes = Array.from({ length: 100 }, (_, i) => 100 + i);
  const { pos } = positionsFor(closes, 'momentum');
  assert.strictEqual(pos[0], 0);
  assert.strictEqual(pos[59], 0);
  assert.strictEqual(pos[80], 1);
});

function velas(closes) {
  return closes.map((c, i) => {
    const p = i ? closes[i - 1] : c;
    return [i * 86400000, p, c * 1.01, c * 0.99, c, 1000 + i];
  });
}

test('realityCheck: comprar-y-mantener gana en tendencia alcista; mínimo de velas', () => {
  const alcista = Array.from({ length: 400 }, (_, i) => 100 * Math.exp(i * 0.004 + Math.sin(i / 7) * 0.01));
  const out = realityCheck(velas(alcista), { costBps: 5 });
  assert.strictEqual(out.ok, true);
  const hold = out.rows.find(r => r.id === 'hold');
  assert.ok(hold.total > 0);
  assert.strictEqual(out.rows.length, STRATEGIES.length);
  // serie corta → error honesto
  assert.strictEqual(realityCheck(velas(Array.from({ length: 50 }, (_, i) => 100 + i))).ok, false);
});

test('realityCheck: los costes de operar reducen el retorno de la estrategia activa', () => {
  const v = velas(Array.from({ length: 600 }, (_, i) => 100 * Math.exp(i * 0.001 + Math.sin(i / 5) * 0.05)));
  const gratis = realityCheck(v, { costBps: 0 });
  const caro = realityCheck(v, { costBps: 50 });
  assert.ok(caro.rows.find(r => r.id === 'sma').total < gratis.rows.find(r => r.id === 'sma').total);
});

// ------------------------------------------------------------------ Coherence

test('coherence: formatea porcentajes y dinero; no inventa secciones sin datos', () => {
  assert.strictEqual(coherence.pct(0.1234), '+12,3 %');
  assert.strictEqual(coherence.pp(-0.25), '-25,0 pp');
  assert.strictEqual(coherence.money(3888), '3.888 €');
  const r = coherence.build({ regimes: [], sizing: null, twr: null, total: 0 });
  assert.match(r.text, /Sin datos suficientes/);
  assert.strictEqual(r.sections.length, 0);
});

test('coherence: refleja desviaciones del reparto y volatilidad', () => {
  const regimes = [{ ok: true, symbol: 'HBAR', trend: 'bajista', volState: 'alta', volPercentile: 0.72 }];
  const sizing = {
    ok: true, portfolioVol: 0.42, portfolioVolNow: 0.62,
    rows: [
      { symbol: 'XRP', current: 0.758, target: 0.05, value: 3000 },
      { symbol: 'USDC', current: 0.05, target: 0.05, value: 200, cash: true },
    ],
  };
  const twr = { ok: true, total: -0.5, benchmark: -0.25, diff: -0.25, days: 365 };
  const r = coherence.build({ regimes, sizing, twr, total: 4000 });
  assert.ok(r.warnings.some(w => /HBAR.*volatilidad alta/.test(w)));
  assert.ok(r.warnings.some(w => /XRP: 76 %/.test(w)));
  assert.ok(r.warnings.some(w => /volatilidad actual/.test(w)));
});
