'use strict';
// Pruebas del vigilante de régimen (lógica pura, sin red).
// Ejecutar con:  node tests/vigilante.test.js
const test = require('node:test');
const assert = require('node:assert');
const w = require('../lib/regime-watch');

const base = {
  ok: true,
  trend: 'alcista',
  strength: 'fuerte',
  volState: 'media',
  volPercentile: 0.5,
  adx: { value: 30 },
  vol30: 0.45,
  riskMultiplier: 0.75,
  price: 100,
};

test('summarize recorta lo que se guarda y devuelve null si falla', () => {
  const s = w.summarize(base, 123);
  assert.strictEqual(s.trend, 'alcista');
  assert.strictEqual(s.adx, 30);
  assert.strictEqual(s.at, 123);
  assert.strictEqual(w.summarize({ ok: false }), null);
});

test('diff: primera lectura es un aviso inicial', () => {
  const r = w.diff(null, w.summarize(base));
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.reasons[0].kind, 'inicial');
});

test('diff: mismo estado no genera aviso', () => {
  const a = w.summarize(base);
  const b = w.summarize({ ...base, price: 101 });
  const r = w.diff(a, b);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.reasons.length, 0);
});

test('diff: cambio de tendencia avisa', () => {
  const a = w.summarize(base);
  const b = w.summarize({ ...base, trend: 'bajista' });
  const r = w.diff(a, b);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(r.reasons[0], { kind: 'tendencia', from: 'alcista', to: 'bajista' });
});

test('diff: cambio de volatilidad avisa aunque la tendencia no cambie', () => {
  const a = w.summarize(base);
  const b = w.summarize({ ...base, volState: 'alta' });
  const r = w.diff(a, b);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.reasons[0].kind, 'volatilidad');
});

test('message describe la transición y el tamaño sugerido', () => {
  const a = w.summarize(base);
  const b = w.summarize({ ...base, trend: 'bajista', volState: 'alta', riskMultiplier: 0.5, price: 90 });
  const txt = w.message('BTC', a, b, w.diff(a, b).reasons);
  assert.match(txt, /BTC/);
  assert.match(txt, /alcista → bajista/);
  assert.match(txt, /media → alta/);
  assert.match(txt, /75 % → 50 %/);
  assert.match(txt, /90/);
});

test('subject nombra el tipo de cambio', () => {
  assert.match(w.subject('ETH', [{ kind: 'tendencia' }]), /cambio de tendencia/);
  assert.match(w.subject('ETH', [{ kind: 'volatilidad' }]), /cambio de volatilidad/);
  assert.match(w.subject('ETH', [{ kind: 'tendencia' }, { kind: 'volatilidad' }]), /tendencia y volatilidad/);
});

test('shouldNotify: la primera lectura nunca avisa y el enfriamiento manda', () => {
  assert.strictEqual(w.shouldNotify([{ kind: 'inicial' }], true), false);
  assert.strictEqual(w.shouldNotify([{ kind: 'tendencia' }], false), false);
  assert.strictEqual(w.shouldNotify([{ kind: 'tendencia' }], true), true);
  assert.strictEqual(w.shouldNotify([{ kind: 'inicial' }, { kind: 'tendencia' }], true), true);
  assert.strictEqual(w.shouldNotify([], true), false);
});

test('due respeta el intervalo y cooled el enfriamiento', () => {
  const now = Date.now();
  assert.strictEqual(w.due({}, 6, now), true, 'sin lectura previa toca');
  assert.strictEqual(w.due({ at: now - 3600e3 }, 6, now), false, 'hace 1 h con intervalo 6 h: no toca');
  assert.strictEqual(w.due({ at: now - 7 * 3600e3 }, 6, now), true);
  assert.strictEqual(w.cooled(null, 12, now), true);
  assert.strictEqual(w.cooled({ sentAt: now - 3600e3 }, 12, now), false);
  assert.strictEqual(w.cooled({ sentAt: now - 13 * 3600e3 }, 12, now), true);
});
