'use strict';
// Almacenamiento JSON en disco con escritura atómica.
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  try {
    ensureDir(path.dirname(file));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
    return true;
  } catch (e) {
    console.error('[store] no se pudo guardar', file, e.message);
    return false;
  }
}

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

module.exports = { ensureDir, readJson, writeJson, exists };
