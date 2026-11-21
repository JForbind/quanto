'use strict';
// Copias de seguridad: nombres ordenables, rotación y selección de la última.
// Sin fs: recibe listas de nombres y devuelve decisiones (fácil de probar).

const PREFIX = 'quanto-';
const RE = /^quanto-(\d{8})-(\d{6})\.json$/;

/** Nombre de copia ordenable por fecha: quanto-20261121-204530.json */
function backupName(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${PREFIX}${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}.json`;
}

/** Fecha (ms) que contiene el nombre, o null si no es una copia. */
function parseName(name) {
  const m = RE.exec(String(name || ''));
  if (!m) return null;
  const [, d, t] = m;
  const y = +d.slice(0, 4);
  const mo = +d.slice(4, 6);
  const day = +d.slice(6, 8);
  const h = +t.slice(0, 2);
  const mi = +t.slice(2, 4);
  const sec = +t.slice(4, 6);
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const ts = Date.UTC(y, mo - 1, day, h, mi, sec);
  const dt = new Date(ts);
  // evita que el navegador/Fecha normalice fechas imposibles (31 de febrero)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== day) return null;
  return ts;
}

/** ¿Es un nombre de copia válido? (evita rutas y sorpresas al restaurar). */
function isValidName(name) {
  return parseName(name) !== null;
}

/** Nombres de copia ordenados de más antigua a más reciente. */
function sortNames(names) {
  return (names || [])
    .filter(isValidName)
    .sort((a, b) => parseName(a) - parseName(b));
}

/** Qué copias hay que borrar para dejar como máximo `keep` (las más recientes). */
function planPrune(names, keep) {
  const sorted = sortNames(names);
  const n = Number.isFinite(Number(keep)) ? Math.max(1, Math.floor(Number(keep))) : 14;
  if (sorted.length <= n) return [];
  return sorted.slice(0, sorted.length - n);
}

/** La copia más reciente, o null. */
function latest(names) {
  const sorted = sortNames(names);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/** ¿Toca hacer copia automática? (por defecto, una cada 22 h). */
function isDue(names, hours = 22, now = Date.now()) {
  const last = latest(names);
  if (!last) return true;
  return now - parseName(last) >= Math.max(1, Number(hours) || 22) * 3600e3;
}

module.exports = { backupName, parseName, isValidName, sortNames, planPrune, latest, isDue };
