'use strict';
// Normalización, fusión sin duplicados y estadísticas del historial de operaciones.
const { round, num } = require('./util');
const { normalizeType } = require('./csv');

const OP_TYPES = new Set(['buy', 'sell', 'deposit', 'withdrawal', 'rebate', 'reward']);

/** Identificador estable de una operación (id de Bitvavo o huella propia). */
function opKey(op) {
  if (op.id && String(op.id).trim()) return 'id:' + String(op.id).trim();
  return 'fp:' + fingerprint(op);
}

function fingerprint(op) {
  const ts = Math.round((op.ts || 0) / 60000); // minuto
  return [op.type, op.currency, ts, round(op.amount, 8), round(op.paidAmount, 8)].join('|');
}

/** Convierte una operación de la API /account/history al formato interno. */
function opFromAccountHistory(it) {
  if (!it || !it.type) return null;
  const type = normalizeType(it.type);
  if (!OP_TYPES.has(type)) return null;
  const sentCur = String(it.sentCurrency || '').toUpperCase();
  const recvCur = String(it.receivedCurrency || '').toUpperCase();
  const sentAmt = num(it.sentAmount);
  const recvAmt = num(it.receivedAmount);
  const currency = String(it.currency || (type === 'withdrawal' ? sentCur : recvCur || sentCur)).toUpperCase();
  const amount = Math.abs(it.amount !== undefined ? num(it.amount)
    : (type === 'withdrawal' || type === 'sell' ? sentAmt : recvAmt || sentAmt));
  if (!currency || !amount) return null;
  const paidCur = String(it.paidCurrency || (sentCur ? (sentCur === 'EUR' ? sentCur : recvCur) : '')).toUpperCase();
  const paidAmount = Math.abs(num(it.paidAmount !== undefined ? it.paidAmount
    : (sentCur === 'EUR' ? sentAmt : recvCur === 'EUR' ? recvAmt : 0)));
  const ts = typeof it.timestamp === 'number' ? it.timestamp
    : (Date.parse(it.executedAt || it.timestamp || '') || Date.now());
  return {
    id: String(it.transactionId || it.id || ''),
    ts,
    type,
    currency,
    amount,
    quoteCurrency: String(it.quoteCurrency || it.priceCurrency || '').toUpperCase(),
    quotePrice: num(it.quotePrice !== undefined ? it.quotePrice : it.priceAmount),
    paidCurrency: paidCur === 'EUR' ? 'EUR' : paidCur,
    paidAmount,
    paidEur: paidCur === 'EUR' ? paidAmount : (sentCur === 'EUR' ? sentAmt : recvCur === 'EUR' ? recvAmt : 0),
    fee: Math.abs(num(it.feesAmount !== undefined ? it.feesAmount : it.fee)),
    feeCurrency: String(it.feesCurrency || it.feeCurrency || '').toUpperCase(),
    status: it.status || 'Completed',
    address: it.address || null,
    source: 'api',
  };
}

/**
 * Fusiona operaciones nuevas con las existentes sin duplicar.
 * Deduplica por id de Bitvavo y, si no hay id, por huella (tipo+moneda+minuto+importes).
 * Si una operación existente llegó incompleta (sin importe pagado), se enriquece.
 */
function mergeOps(existing, incoming) {
  const ops = (existing || []).map(o => ({ ...o }));
  const byId = new Map();
  const byFp = new Map();
  for (const op of ops) {
    if (op.id) byId.set(String(op.id), op);
    byFp.set(fingerprint(op), op);
  }
  let added = 0;
  let enriched = 0;
  for (const raw of incoming || []) {
    if (!raw || !raw.currency || !raw.amount) continue;
    const op = { ...raw };
    const hitId = op.id ? byId.get(String(op.id)) : null;
    const hitFp = hitId || byFp.get(fingerprint(op));
    if (hitFp) {
      let changed = false;
      for (const k of ['paidEur', 'paidAmount', 'fee', 'quotePrice', 'quoteCurrency', 'feeCurrency', 'address']) {
        if ((hitFp[k] === undefined || hitFp[k] === '' || hitFp[k] === 0) && op[k] !== undefined && op[k] !== '') {
          hitFp[k] = op[k];
          changed = true;
        }
      }
      if (changed) enriched++;
      continue;
    }
    if (!op.id) op.id = '';
    ops.push(op);
    byFp.set(fingerprint(op), op);
    if (op.id) byId.set(String(op.id), op);
    added++;
  }
  ops.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return { ops, added, enriched };
}

/**
 * Estadísticas por moneda a partir del historial.
 * - coste medio ponderado de las compras
 * - beneficio realizado solo sobre la parte "casada" (si vendes más de lo comprado,
 *   lo sobrante se marca como unmatched en vez de contarlo como beneficio puro)
 */
function analyze(ops) {
  const sorted = (ops || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const byCoin = {};
  const totals = {
    depositsEur: 0, withdrawalsEur: 0, rebatesEur: 0,
    boughtCost: 0, soldProceeds: 0, feesEur: 0,
    buys: 0, sells: 0, deposits: 0, withdrawals: 0, other: 0,
  };

  for (const op of sorted) {
    const feeEur = op.feeCurrency === 'EUR' ? num(op.fee) : 0;
    if (op.currency === 'EUR') {
      if (op.type === 'deposit') totals.depositsEur += op.amount;
      else if (op.type === 'withdrawal') totals.withdrawalsEur += op.amount;
      else if (op.type === 'rebate' || op.type === 'reward') totals.rebatesEur += op.amount;
      totals.feesEur += feeEur;
      continue;
    }
    if (!OP_TYPES.has(op.type)) { totals.other++; continue; }

    const g = byCoin[op.currency] || (byCoin[op.currency] = {
      symbol: op.currency,
      bought: 0, cost: 0, sold: 0, proceeds: 0, feesEur: 0,
      deposited: 0, withdrawn: 0,
      holdings: 0, avgCost: 0, realized: 0,
      unmatchedSold: 0, unmatchedProceeds: 0,
      sells: [], firstTs: 0, lastTs: 0,
    });
    g.firstTs = g.firstTs || op.ts || 0;
    g.lastTs = Math.max(g.lastTs, op.ts || 0);

    if (op.type === 'deposit') { g.deposited += op.amount; totals.deposits++; continue; }
    if (op.type === 'withdrawal') { g.withdrawn += op.amount; totals.withdrawals++; continue; }

    if (op.type === 'buy' || op.type === 'reward') {
      const cost = op.type === 'buy' ? (op.paidEur || (op.amount * (op.quotePrice || 0) + feeEur)) : 0;
      const newHoldings = g.holdings + op.amount;
      g.avgCost = newHoldings > 0 ? (g.avgCost * g.holdings + cost) / newHoldings : 0;
      g.holdings = newHoldings;
      g.bought += op.amount;
      g.cost += cost;
      g.feesEur += feeEur;
      if (op.type === 'buy') totals.buys++;
      else totals.other++;
      totals.boughtCost += cost;
      totals.feesEur += feeEur;
      continue;
    }

    if (op.type === 'sell') {
      const proceeds = op.paidEur || (op.amount * (op.quotePrice || 0) - feeEur);
      const matched = Math.min(op.amount, g.holdings);
      const realized = matched > 0 ? (proceeds * (matched / op.amount)) - g.avgCost * matched : 0;
      const unmatched = op.amount - matched;
      g.realized += realized;
      g.holdings = Math.max(0, g.holdings - matched);
      g.sold += op.amount;
      g.proceeds += proceeds;
      g.feesEur += feeEur;
      if (unmatched > 1e-12) {
        g.unmatchedSold += unmatched;
        g.unmatchedProceeds += proceeds * (unmatched / op.amount);
      }
      g.sells.push({
        ts: op.ts,
        amount: op.amount,
        price: op.quotePrice || (op.amount ? proceeds / op.amount : 0),
        proceeds: round(proceeds),
        realized: round(realized),
        unmatched: round(unmatched, 8),
      });
      totals.sells++;
      totals.soldProceeds += proceeds;
      totals.feesEur += feeEur;
    }
  }

  const sells = [];
  const byCoinRealized = {};
  let totalRealized = 0;
  let totalUnmatched = 0;
  for (const g of Object.values(byCoin)) {
    g.amount = round(Math.max(0, g.holdings), 8);
    g.avgCost = g.bought > 0 ? g.cost / g.bought : null;
    g.realized = round(g.realized);
    g.cost = round(g.cost, 2);
    g.proceeds = round(g.proceeds, 2);
    g.bought = round(g.bought, 8);
    g.sold = round(g.sold, 8);
    g.unmatchedSold = round(g.unmatchedSold, 8);
    g.unmatchedProceeds = round(g.unmatchedProceeds, 2);
    totalRealized += g.realized;
    totalUnmatched += g.unmatchedProceeds;
    for (const s of g.sells) sells.push({ ...s, symbol: g.symbol });
    if (g.sells.length) byCoinRealized[g.symbol] = { realized: g.realized, sells: g.sells.length };
  }
  sells.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  for (const k of Object.keys(totals)) totals[k] = round(totals[k], 2);

  return {
    byCoin,
    sorted,
    totals,
    realized: {
      total: round(totalRealized),
      unmatchedProceeds: round(totalUnmatched),
      byCoin: byCoinRealized,
      sells: sells.slice(0, 300),
    },
    range: {
      from: sorted.length ? sorted[0].ts : null,
      to: sorted.length ? sorted[sorted.length - 1].ts : null,
      count: sorted.length,
    },
  };
}

/** Movimientos entre Bitvavo y la wallet fría. */
function storeMoves(ops, limit = 200) {
  return (ops || [])
    .filter(o => (o.type === 'withdrawal' || o.type === 'deposit') && o.currency !== 'EUR')
    .map(o => ({ ts: o.ts, dir: o.type === 'withdrawal' ? 'out' : 'in', symbol: o.currency, amount: o.amount, fee: o.fee, address: o.address }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, limit);
}

module.exports = { opKey, fingerprint, opFromAccountHistory, mergeOps, analyze, storeMoves, OP_TYPES };
