'use strict';
// Pruebas del doble factor (TOTP y códigos de respaldo), sin dependencias externas.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const totp = require('../lib/totp');
const { createUserStore } = require('../lib/users');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FALLO ' + name + ': ' + e.message);
    process.exitCode = 1;
  }
}

// --- vectores oficiales de la RFC 6238 (SHA-1, 8 dígitos recortados a 6) ---
const RFC_SECRETO = totp.base32Encode(Buffer.from('12345678901234567890'));

test('el vector de la RFC en T=59 s da 287082', () => {
  assert.strictEqual(totp.codigo(RFC_SECRETO, Math.floor(59 / 30)), '287082');
});

test('el vector de la RFC en T=1111111109 da 081804', () => {
  assert.strictEqual(totp.codigo(RFC_SECRETO, Math.floor(1111111109 / 30)), '081804');
});

test('un código recién generado es válido', () => {
  const secreto = totp.nuevoSecreto();
  assert.ok(totp.verificar(secreto, totp.codigoActual(secreto)));
});

test('acepta el código del intervalo anterior (margen ±1)', () => {
  const secreto = totp.nuevoSecreto();
  const hace = Date.now() - totp.PASO * 1000;
  assert.ok(totp.verificar(secreto, totp.codigoActual(secreto, hace)));
});

test('rechaza un código del pasado lejano', () => {
  const secreto = totp.nuevoSecreto();
  const antiguo = Date.now() - totp.PASO * 1000 * 10;
  assert.ok(!totp.verificar(secreto, totp.codigoActual(secreto, antiguo)));
});

test('rechaza códigos con formato raro', () => {
  const secreto = totp.nuevoSecreto();
  assert.ok(!totp.verificar(secreto, ''));
  assert.ok(!totp.verificar(secreto, '12345'));
  assert.ok(!totp.verificar(secreto, 'abcdef'));
});

test('el secreto es base32 válido de 32 caracteres', () => {
  const s = totp.nuevoSecreto();
  assert.strictEqual(s.length, 32);
  assert.match(s, /^[A-Z2-7]+$/);
  assert.strictEqual(totp.base32Decode(s).length, 20);
});

test('el enlace otpauth lleva el estándar esperado', () => {
  const s = totp.nuevoSecreto();
  const uri = totp.uri(s, 'jorge');
  assert.ok(uri.startsWith('otpauth://totp/Quanto%3Ajorge?'));
  assert.ok(uri.includes('secret=' + s));
  assert.ok(uri.includes('algorithm=SHA1'));
  assert.ok(uri.includes('digits=6'));
  assert.ok(uri.includes('period=30'));
});

test('los códigos de respaldo son únicos y se pueden hashear', () => {
  const lista = totp.codigosRespaldo(10);
  assert.strictEqual(lista.length, 10);
  assert.strictEqual(new Set(lista).size, 10);
  for (const c of lista) {
    assert.match(c, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
    assert.strictEqual(totp.hashCodigo(c).length, 64);
  }
  // el hash ignora guiones y mayúsculas
  assert.strictEqual(totp.hashCodigo(lista[0]), totp.hashCodigo(lista[0].toLowerCase().replace('-', '')));
});

// --- almacenamiento en el usuario ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanto-2fa-'));
const users = createUserStore(dir);
const u = users.create({ username: 'jorge', password: 'ClaveSegura!2026' });

test('un usuario nuevo no tiene doble factor', () => {
  const p = users.publicUser(users.findById(u.id));
  assert.strictEqual(p.totp, false);
});

test('se guarda el secreto pendiente sin activarlo', () => {
  users.setTotpPending(u.id, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  const guardado = users.findById(u.id);
  assert.strictEqual(guardado.totpPending, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  assert.ok(!guardado.totpEnabled);
});

test('activar guarda secreto, fecha y códigos de respaldo', () => {
  const hashes = ['a'.repeat(64), 'b'.repeat(64)];
  users.enableTotp(u.id, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', hashes);
  const guardado = users.findById(u.id);
  assert.strictEqual(guardado.totpEnabled, true);
  assert.ok(guardado.totpSince > 0);
  assert.strictEqual(guardado.totpPending, null);
  assert.deepStrictEqual(guardado.totpBackup, hashes);
  assert.strictEqual(users.publicUser(guardado).totp, true);
});

test('un código de respaldo se consume una sola vez', () => {
  const hash = 'a'.repeat(64);
  assert.strictEqual(users.consumeBackupCode(u.id, hash), true);
  assert.strictEqual(users.consumeBackupCode(u.id, hash), false);
});

test('desactivar borra el secreto y los códigos', () => {
  users.disableTotp(u.id);
  const guardado = users.findById(u.id);
  assert.strictEqual(guardado.totpEnabled, false);
  assert.strictEqual(guardado.totpSecret, null);
  assert.deepStrictEqual(guardado.totpBackup, []);
  assert.strictEqual(users.publicUser(guardado).totp, false);
});

console.log(`\n${passed} pruebas correctas`);
