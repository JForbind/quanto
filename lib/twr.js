'use strict';
// TWR (rentabilidad ponderada por tiempo) y comparación con mantener BTC.
// La idea: una compra o una venta no deben contar como "rendimiento", solo como
// dinero que entra o sale. Se descuenta el flujo del día antes de calcular el retorno.

const DAY = 86400e3;

function dayKey(ts) {
  const d = new Date(Number(ts));
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Flujo neto en euros por día: compras suman (aportas) y ventas restan (retiras). */
function tradeFlows(ops) {
  const map = new Map();
  for (const op of ops || []) {
    if (!op || !op.ts) continue;
    if (op.type !== 'buy' && op.type !== 'sell') continue;
    const amount = Number(op.paidEur) || (Number(op.amount) || 0) * (Number(op.quotePrice) || 0);
    if (!isFinite(amount) || amount <= 0) continue;
    const k = dayKey(op.ts);
    map.set(k, (map.get(k) || 0) + (op.type === 'buy' ? amount : -amount));
  }
  return map;
}

/** Precio de una serie [{t, close}] en un instante (último conocido ≤ ts). */
function priceAt(series, ts) {
  let last = null;
  for (const p of series || []) {
    if (p.t <= ts) last = p.close; else break;
  }
  return last;
}

/**
 * @param {{points:Array<{t:number,value:number}>, ops:Array, btc?:Array<{t:number,close:number}>, days?:number}} input
 */
function computeTwr({ points, ops, btc, days } = {}) {
  const list = (Array.isArray(points) ? points : [])
    .filter(p => p && isFinite(p.t) && isFinite(p.value))
    .sort((a, b) => a.t - b.t);
  if (list.length < 2) return { ok: false, error: 'Hacen falta al menos dos días de histórico.' };

  const endTs = list[list.length - 1].t;
  const startTs = days ? Math.max(list[0].t, endTs - Number(days) * DAY) : list[0].t;
  const seg = list.filter(p => p.t >= startTs);
  if (seg.length < 2) return { ok: false, error: 'El periodo elegido no tiene datos suficientes.' };

  const flows = tradeFlows(ops);
  let twr = 1;
  let daysSpan = 0;
  for (let i = 1; i < seg.length; i++) {
    const prev = seg[i - 1];
    const cur = seg[i];
    if (!(prev.value > 0)) continue;
    const f = flows.get(dayKey(cur.t)) || 0;
    const r = (cur.value - f) / prev.value - 1;
    if (!isFinite(r)) continue;
    twr *= 1 + r;
    daysSpan += Math.max(0, (cur.t - prev.t) / DAY);
  }
  if (!daysSpan) return { ok: false, error: 'No hay días con datos de precio en el periodo.' };

  const total = twr - 1;
  const annual = total > -1 ? Math.pow(1 + total, 365 / daysSpan) - 1 : -1;

  let benchmark = null;
  let benchmarkAnnual = null;
  if (Array.isArray(btc) && btc.length > 1) {
    const p0 = priceAt(btc, seg[0].t);
    const p1 = priceAt(btc, seg[seg.length - 1].t);
    if (p0 > 0 && p1 > 0) {
      benchmark = p1 / p0 - 1;
      benchmarkAnnual = benchmark > -1 ? Math.pow(1 + benchmark, 365 / daysSpan) - 1 : -1;
    }
  }

  const flowTotal = [...flows.entries()]
    .filter(([k]) => k >= startTs && k <= endTs)
    .reduce((a, [, v]) => a + v, 0);

  return {
    ok: true,
    total,
    annual,
    benchmark,
    benchmarkAnnual,
    diff: benchmark == null ? null : total - benchmark,
    days: Math.round(daysSpan),
    from: seg[0].t,
    to: seg[seg.length - 1].t,
    flows: flowTotal,
    startValue: seg[0].value,
    endValue: seg[seg.length - 1].value,
    points: seg.length,
  };
}

module.exports = { computeTwr, tradeFlows, dayKey, priceAt };
