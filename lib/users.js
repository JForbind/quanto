'use strict';
// Almacén de usuarios: registro, contraseñas, tokens de invitación y política.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./auth');
const { readJson, writeJson, ensureDir } = require('./store');

const POLICY = {
  min: 12,
  rules: [
    { test: (s) => /[A-ZÁÉÍÓÚÜÑ]/.test(s), label: 'una mayúscula' },
    { test: (s) => /[a-záéíóúüñ]/.test(s), label: 'una minúscula' },
    { test: (s) => /[0-9]/.test(s), label: 'un número' },
    { test: (s) => /[^A-Za-z0-9]/.test(s), label: 'un carácter especial' },
  ],
};

/** Devuelve la lista de requisitos que faltan (vacía = contraseña válida). */
function passwordProblems(pw) {
  const s = String(pw == null ? '' : pw);
  const problems = [];
  if (s.length < POLICY.min) problems.push(`al menos ${POLICY.min} caracteres`);
  for (const r of POLICY.rules) if (!r.test(s)) problems.push(r.label);
  return problems;
}

function randomPassword(len = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*?';
  const all = upper + lower + digits + special;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < len) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function createUserStore(dataDir) {
  const dir = path.join(dataDir, 'users');
  const file = path.join(dataDir, 'users.json');
  ensureDir(dir);

  function load() {
    const raw = readJson(file, null);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.users)) return { users: [] };
    return raw;
  }
  function save(store) { writeJson(file, store); }
  function list() { return load().users; }
  function findById(id) { return list().find((u) => u.id === id) || null; }
  function findByUsername(username) {
    const u = String(username || '').trim().toLowerCase();
    return list().find((x) => x.username.toLowerCase() === u) || null;
  }
  function findByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    return list().find((x) => (x.email || '').toLowerCase() === e) || null;
  }

  function userDir(id) {
    const d = path.join(dir, id);
    ensureDir(d);
    return d;
  }

  function create({ username, email, role = 'user', password = null, passwordHash = null, mustChange = false, onlyFile = null, canData = null }) {
    const store = load();
    const id = crypto.randomBytes(6).toString('hex');
    const record = {
      id,
      username: String(username || '').trim(),
      email: String(email || '').trim(),
      role: role === 'admin' ? 'admin' : 'user',
      active: true,
      sessionVersion: 1,
      mustChange: !!mustChange,
      canData: role === 'admin' ? canData === true : true,
      createdAt: Date.now(),
      lastLoginAt: null,
      resetRequestedAt: null,
      inviteTokenHash: null,
      inviteExpiresAt: null,
    };
    if (passwordHash && passwordHash.hash && passwordHash.salt) {
      record.hash = passwordHash.hash;
      record.salt = passwordHash.salt;
      record.algo = 'scrypt';
    } else if (password) {
      Object.assign(record, hashPassword(password));
    }
    store.users.push(record);
    save(store);
    userDir(id);
    if (onlyFile) {
      // deja el usuario sin contraseña y usa un token de invitación
      issueInvite(id, 72);
    }
    return record;
  }

  function update(id, patch) {
    const store = load();
    const u = store.users.find((x) => x.id === id);
    if (!u) return null;
    Object.assign(u, patch);
    save(store);
    return u;
  }

  function setPassword(id, password, { mustChange = false } = {}) {
    const store = load();
    const u = store.users.find((x) => x.id === id);
    if (!u) return null;
    const hashed = hashPassword(password);
    u.hash = hashed.hash;
    u.salt = hashed.salt;
    u.algo = 'scrypt';
    u.mustChange = !!mustChange;
    u.sessionVersion = (u.sessionVersion || 1) + 1;
    u.inviteTokenHash = null;
    u.inviteExpiresAt = null;
    save(store);
    return u;
  }

  function checkPassword(id, password) {
    const u = findById(id);
    if (!u || !u.hash) return false;
    return verifyPassword(password, u);
  }

  function login(username, password) {
    const u = findByUsername(username);
    if (!u || u.active === false) return { error: 'credenciales' };
    if (!u.hash) return { error: 'invitacion-pendiente' };
    if (!verifyPassword(password, u)) return { error: 'credenciales' };
    update(u.id, { lastLoginAt: Date.now() });
    return { user: findById(u.id) };
  }

  function issueInvite(id, hours = 72) {
    const token = crypto.randomBytes(24).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    update(id, { inviteTokenHash: hash, inviteExpiresAt: Date.now() + hours * 3600e3 });
    return { token, expiresAt: Date.now() + hours * 3600e3 };
  }

  function inviteByToken(token) {
    if (!token) return null;
    const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const u = list().find((x) => x.inviteTokenHash === hash);
    if (!u) return null;
    if (!u.inviteExpiresAt || u.inviteExpiresAt < Date.now()) return null;
    return u;
  }

  function acceptInvite(token, password) {
    const u = inviteByToken(token);
    if (!u) return { error: 'token' };
    const problems = passwordProblems(password);
    if (problems.length) return { error: 'politica', problems };
    setPassword(u.id, password, { mustChange: false });
    return { user: findById(u.id) };
  }

  function requestReset(identifier) {
    const key = String(identifier || '').trim();
    const u = findByUsername(key) || findByEmail(key);
    if (!u) return null;
    update(u.id, { resetRequestedAt: Date.now() });
    return u;
  }

  function remove(id) {
    const store = load();
    const i = store.users.findIndex((u) => u.id === id);
    if (i < 0) return false;
    store.users.splice(i, 1);
    save(store);
    try { fs.rmSync(path.join(dir, id), { recursive: true, force: true }); } catch {}
    return true;
  }

  function publicUser(u) {
    if (!u) return null;
    return {
      id: u.id, username: u.username, email: u.email, role: u.role,
      active: u.active !== false, mustChange: !!u.mustChange, canData: u.canData !== false,
      createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
      resetRequestedAt: u.resetRequestedAt || null,
      invitePending: !!(u.inviteTokenHash && u.inviteExpiresAt > Date.now()),
    };
  }

  return {
    list, findById, findByUsername, findByEmail, create, update, setPassword,
    checkPassword, login, issueInvite, inviteByToken, acceptInvite, requestReset,
    remove, publicUser, userDir, randomPassword,
  };
}

module.exports = { createUserStore, passwordProblems, randomPassword, POLICY };
