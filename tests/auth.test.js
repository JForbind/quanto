'use strict';
// Pruebas de autenticación y multi-usuario (sin dependencias externas).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createUserStore, passwordProblems } = require('../lib/users');
const { createSessionToken, verifySessionToken, hashPassword, verifyPassword } = require('../lib/auth');

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanto-auth-'));
const users = createUserStore(dir);

console.log('Política de contraseñas');
test('rechaza cortas y sin variedad', () => {
  const p = passwordProblems('corta');
  assert(p.includes('al menos 12 caracteres'));
  assert(p.includes('una mayúscula'));
  assert(p.includes('un número'));
  assert(p.includes('un carácter especial'));
});
test('acepta una válida', () => {
  assert.deepStrictEqual(passwordProblems('Jaime2026!Segura'), []);
});

console.log('Hash y verificación');
test('verifica la contraseña correcta', () => {
  const h = hashPassword('Secreta2026!X');
  assert(verifyPassword('Secreta2026!X', h));
  assert(!verifyPassword('otra', h));
});
test('sales distintas para la misma contraseña', () => {
  const a = hashPassword('Secreta2026!X');
  const b = hashPassword('Secreta2026!X');
  assert.notStrictEqual(a.salt, b.salt);
  assert.notStrictEqual(a.hash, b.hash);
});

console.log('Sesiones');
test('token válido devuelve la carga', () => {
  const tok = createSessionToken('secreto-de-prueba', { u: 'abc', v: 2 }, 60e3);
  const data = verifySessionToken('secreto-de-prueba', tok);
  assert(data && data.u === 'abc' && data.v === 2);
});
test('token manipulado se rechaza', () => {
  const tok = createSessionToken('secreto-de-prueba', { u: 'abc', v: 1 }, 60e3);
  const [body] = tok.split('.');
  const falso = body + '.' + 'x'.repeat(43);
  assert.strictEqual(verifySessionToken('secreto-de-prueba', falso), null);
});
test('token caducado se rechaza', () => {
  const tok = createSessionToken('secreto-de-prueba', { u: 'abc', v: 1 }, -1000);
  assert.strictEqual(verifySessionToken('secreto-de-prueba', tok), null);
});
test('otro secreto no vale', () => {
  const tok = createSessionToken('secreto-A', { u: 'abc', v: 1 }, 60e3);
  assert.strictEqual(verifySessionToken('secreto-B', tok), null);
});

console.log('Usuarios');
let jorge;
test('crea usuario con contraseña', () => {
  jorge = users.create({ username: 'jorge', role: 'user', password: 'Jorge2026!Segura' });
  assert(jorge.id && jorge.hash && jorge.salt);
  assert.strictEqual(jorge.role, 'user');
  assert.strictEqual(jorge.canData, true);
});
test('el login correcto entra', () => {
  const out = users.login('jorge', 'Jorge2026!Segura');
  assert(out.user && out.user.id === jorge.id);
});
test('el login incorrecto no entra', () => {
  assert(users.login('jorge', 'mal').error === 'credenciales');
  assert(users.login('nadie', 'x').error === 'credenciales');
});
test('el admin no tiene datos por defecto', () => {
  const admin = users.create({ username: 'admin', role: 'admin', password: 'Admin2026!Segura' });
  assert.strictEqual(admin.canData, false);
});
test('invitación: token válido, caduca y se usa una vez', () => {
  const nuevo = users.create({ username: 'jaime', role: 'user' });
  const { token } = users.issueInvite(nuevo.id, 72);
  assert(users.inviteByToken(token));
  const out = users.acceptInvite(token, 'Jaime2026!Segura');
  assert(out.user && out.user.id === nuevo.id);
  assert.strictEqual(users.inviteByToken(token), null, 'el token no debe reutilizarse');
});
test('invitación rechaza contraseña débil', () => {
  const nuevo = users.create({ username: 'pepe', role: 'user' });
  const { token } = users.issueInvite(nuevo.id, 72);
  const out = users.acceptInvite(token, 'debil');
  assert.strictEqual(out.error, 'politica');
  assert(out.problems.length > 0);
});
test('cambiar contraseña sube sessionVersion y borra el token', () => {
  const antes = users.findById(jorge.id).sessionVersion;
  users.setPassword(jorge.id, 'Nueva2026!Segura');
  const despues = users.findById(jorge.id);
  assert(despues.sessionVersion > antes);
  assert.strictEqual(despues.inviteTokenHash, null);
});
test('desactivar bloquea el login', () => {
  users.update(jorge.id, { active: false });
  assert(users.login('jorge', 'Nueva2026!Segura').error === 'credenciales');
  users.update(jorge.id, { active: true });
  assert(users.login('jorge', 'Nueva2026!Segura').user);
});
test('usuario sin contraseña no puede entrar', () => {
  const pend = users.create({ username: 'pend', role: 'user' });
  assert(users.login('pend', 'loquesea').error === 'invitacion-pendiente');
  assert(pend.id);
});
test('borrar elimina el usuario y su carpeta', () => {
  const tmp = users.create({ username: 'temporal', role: 'user', password: 'Temporal2026!X' });
  const carpeta = users.userDir(tmp.id);
  assert(fs.existsSync(carpeta));
  users.remove(tmp.id);
  assert.strictEqual(users.findById(tmp.id), null);
  assert(!fs.existsSync(carpeta));
});
test('no hay dos usuarios con el mismo nombre', () => {
  assert(users.findByUsername('JORGE').id === jorge.id);
});

console.log('\n' + passed + ' pruebas correctas');
fs.rmSync(dir, { recursive: true, force: true });
