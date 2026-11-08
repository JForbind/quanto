'use strict';
// Lectura del "Historial completo" de Bitvavo (CSV exportado desde la web).
// Es la única fuente que trae TODAS las operaciones: la API de solo lectura no
// devuelve el histórico antiguo (solo las últimas 100 operaciones de la cuenta).
const { parseNumber, parseTimestamp } = require('./util');

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function detectSeparator(lines) {
  // Gana el separador que aparece más veces en la cabecera.
  const sample = lines.slice(0, 15).join('\n');
  const semi = (sample.match(/;/g) || []).length;
  const comma = (sample.match(/,/g) || []).length;
  const tab = (sample.match(/\t/g) || []).length;
  if (tab > semi && tab > comma) return '\t';
  return semi > comma ? ';' : ',';
}

function normHeader(h) {
  return String(h || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
}

const ALIASES = {
  type: ['type', 'tipo'],
  currency: ['currency', 'moneda'],
  amount: ['amount', 'cantidad'],
  quoteCurrency: ['quote currency', 'quote'],
  quotePrice: ['quote price', 'price'],
  paidCurrency: ['received/paid currency', 'received / paid currency', 'paid currency'],
  paidAmount: ['received/paid amount', 'received / paid amount', 'paid amount'],
  fee: ['fee amount', 'fee'],
  feeCurrency: ['fee currency'],
  status: ['status', 'estado'],
  id: ['transaction id', 'transactionid', 'id'],
  address: ['address', 'dirección', 'direccion'],
  date: ['date', 'fecha'],
  time: ['time', 'hora'],
};

function mapColumns(headerCells) {
  const map = {};
  headerCells.forEach((cell, i) => {
    const h = normHeader(cell);
    for (const [key, names] of Object.entries(ALIASES)) {
      if (map[key] === undefined && names.includes(h)) map[key] = i;
    }
  });
  return map;
}

function normalizeType(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (t.startsWith('withdraw')) return 'withdrawal';
  if (t.startsWith('deposit')) return 'deposit';
  if (t === 'buy' || t === 'compra') return 'buy';
  if (t === 'sell' || t === 'venta') return 'sell';
  if (t === 'rebate' || t === 'rebaja') return 'rebate';
  if (t === 'staking' || t === 'reward' || t === 'airdrop') return 'reward';
  return t;
}

/**
 * Convierte el CSV del historial de Bitvavo en operaciones normalizadas.
 * Devuelve [] si no reconoce la cabecera.
 */
function parseBitvavoHistory(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const lines = src.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const sep = detectSeparator(lines);
  let headerIdx = -1;
  let columns = null;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const cells = splitCsvLine(lines[i], sep);
    const map = mapColumns(cells);
    if (map.type !== undefined && map.currency !== undefined && map.amount !== undefined) {
      headerIdx = i;
      columns = map;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const cell = (cells, key) => {
    const i = columns[key];
    return i === undefined || cells[i] === undefined ? '' : String(cells[i]).trim();
  };

  const ops = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], sep);
    if (!cells.length) continue;
    const type = normalizeType(cell(cells, 'type'));
    const currency = cell(cells, 'currency').toUpperCase();
    if (!type || !currency) continue;
    const amount = Math.abs(parseNumber(cell(cells, 'amount')));
    if (!amount && type !== 'rebate') continue;

    const ts = parseTimestamp(cell(cells, 'date'), cell(cells, 'time'));
    const paidCurrency = cell(cells, 'paidCurrency').toUpperCase();
    const paidAmount = parseNumber(cell(cells, 'paidAmount'));
    const fee = Math.abs(parseNumber(cell(cells, 'fee')));
    const quoteCurrency = cell(cells, 'quoteCurrency').toUpperCase();

    ops.push({
      id: cell(cells, 'id') || '',
      ts,
      type,
      currency,
      amount,
      quoteCurrency,
      quotePrice: parseNumber(cell(cells, 'quotePrice')),
      paidCurrency,
      paidAmount,
      // En compras el importe pagado incluye comisión; en ventas es el neto recibido.
      paidEur: paidCurrency === 'EUR' ? Math.abs(paidAmount) : 0,
      fee,
      feeCurrency: cell(cells, 'feeCurrency').toUpperCase(),
      status: cell(cells, 'status'),
      address: cell(cells, 'address') || null,
    });
  }
  return ops;
}

module.exports = { parseBitvavoHistory, splitCsvLine, detectSeparator, normalizeType };
