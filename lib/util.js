'use strict';
// Utilidades numéricas y de fechas compartidas por el servidor.

function round(v, d = 2) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

// Acepta "1.234,56", "1,234.56", "1234.56", "1 234,56"...
function parseNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[\s\u00a0]/g, '').replace(/€/g, '').replace(/EUR/gi, '');
  if (!s) return 0;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma > -1 && dot > -1) {
    if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (comma > -1) {
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (dot > -1 && s.split('.').length > 2) {
    s = s.replace(/\./g, ''); // 1.234.567 -> miles
  }
  s = s.replace(/[^0-9.eE+-]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Fechas de Bitvavo: "2024-01-03" o "03-01-2024" (día primero) + hora opcional.
function parseTimestamp(dateStr, timeStr) {
  const date = String(dateStr || '').trim();
  if (!date) return 0;
  const time = /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(timeStr || '').trim())
    ? String(timeStr).trim().padEnd(8, ':00')
    : '00:00:00';
  let y, m, d;
  let match = date.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) { y = +match[1]; m = +match[2]; d = +match[3]; }
  else {
    match = date.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (!match) return Date.parse(date) || 0;
    d = +match[1]; m = +match[2]; y = +match[3];
    if (y < 100) y += 2000;
    // Si el primer grupo no puede ser un día, interpretamos mes primero (formato US).
    if (d > 12 && m > 12) return 0;
    if (d <= 12 && m <= 12) { /* ambiguo: Bitvavo exporta día primero */ }
    else if (d > 12) { /* ya es día */ }
    else { const tmp = d; d = m; m = tmp; }
  }
  if (!y || !m || !d) return 0;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${time}Z`;
  const ts = Date.parse(iso);
  return isFinite(ts) ? ts : 0;
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

module.exports = { round, num, parseNumber, parseTimestamp, dayKey, clamp };
