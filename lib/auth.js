'use strict';
// Contraseña (scrypt), token de sesión firmado y límite de intentos de login.
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
  return { salt, hash, algo: 'scrypt' };
}

function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  try {
    const hash = crypto.scryptSync(String(password), stored.salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(stored.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Token de sesión: "<caduca>.<firma>". Caduca solo. */
function createToken(secret, ttlMs) {
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac('sha256', secret).update('session:' + exp).digest('base64url');
  return `${exp}.${sig}`;
}

function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return false;
  const [expRaw, sig] = token.split('.');
  if (!expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!isFinite(exp) || exp < Date.now()) return false;
  const expected = crypto.createHmac('sha256', secret).update('session:' + exp).digest('base64url');
  return safeEqual(sig, expected);
}

/** Límite simple de intentos por IP (en memoria). */
function createLimiter({ windowMs = 10 * 60e3, max = 8 } = {}) {
  const hits = new Map();
  return {
    check(ip) {
      const now = Date.now();
      const rec = hits.get(ip);
      if (!rec || now > rec.resetAt) {
        hits.set(ip, { count: 1, resetAt: now + windowMs });
        if (hits.size > 5000) hits.clear();
        return { allowed: true, remaining: max - 1 };
      }
      rec.count++;
      if (rec.count > max) {
        return { allowed: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
      }
      return { allowed: true, remaining: max - rec.count };
    },
    reset(ip) { hits.delete(ip); },
  };
}

module.exports = { hashPassword, verifyPassword, safeEqual, createToken, verifyToken, createLimiter };
