'use strict';
// Piezas de una moneda: insignia, fila de tabla, rangos y minigráfico.
import { esc, num, eur, pct, priceFmt, signed, state } from '../core.js';
import { hexA } from './charts.js';
import { RANGES, rangeFmt, athFuente, anioCobertura, avisoExchange } from '../data/ranges.js';

export const PIE_COLORS = ['#8ba4ff', '#22d3ee', '#a78bfa', '#34e0a1', '#ffc266', '#ff7387', '#60a5fa', '#f472b6', '#4ade80', '#facc15', '#c084fc', '#2dd4bf'];

export function coinColor(symbol) {
  let h = 0;
  for (const ch of String(symbol)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PIE_COLORS[h % PIE_COLORS.length];
}

export let COIN_ICONS = new Set();
export async function loadCoinIcons() {
  try {
    const res = await fetch('/icons/coins/index.json', { cache: 'force-cache' });
    if (res.ok) COIN_ICONS = new Set((await res.json()).map(s => String(s).toLowerCase()));
  } catch { /* sin iconos: se usa la insignia con letras */ }
}

export function coinBadge(symbol) {
  const sym = String(symbol || '').toLowerCase();
  if (COIN_ICONS.has(sym)) {
    return `<span class="coin-badge coin-badge-icon"><img src="/icons/coins/${encodeURIComponent(sym)}.png" alt="" loading="lazy" decoding="async"></span>`;
  }
  const c = coinColor(symbol);
  const label = String(symbol).length <= 4 ? String(symbol) : String(symbol).slice(0, 3);
  const dyn = `<img class="coin-badge-dyn" src="/api/icon/${encodeURIComponent(String(symbol).toUpperCase())}" alt="" loading="lazy" decoding="async">`;
  return `<span class="coin-badge" style="background:linear-gradient(140deg,${c},${hexA(c, .55)})">${esc(label)}${dyn}</span>`;
}

export function sparklineSvg(values) {
  if (!Array.isArray(values) || values.length < 2) return '<span class="muted">—</span>';
  const w = 72, h = 26, pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = values[values.length - 1] >= values[0];
  const color = up ? 'var(--pos)' : 'var(--neg)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function rngBlock(symbol) {
  const r = RANGES[symbol];
  if (!r || (!r.high && !r.ath)) return '';
  const y = r.year || new Date().getFullYear();
  const etiquetaMax = r.athApprox && r.athFrom
    ? 'Máximo desde ' + new Date(r.athFrom).getFullYear()
    : 'Máximo histórico';
  const ayudaMax = [athFuente(r), avisoExchange(r)].filter(Boolean).join(' · ');
  const cell = (label, value, approx, title, cls = '') => `<span class="rng-cell${cls ? ' ' + cls : ''}"><i>${label}</i><b${approx ? ` class="approx"${title ? ` title="${esc(title)}"` : ''}` : ''}>${value ? (approx ? '≈ ' : '') + rangeFmt(value) + ' €' : '—'}</b></span>`;
  return `<div class="coin-rng">
    ${cell('Máximo ' + y + (anioCobertura(r) ? ' (' + anioCobertura(r) + ')' : ''), r.high)}
    ${cell(etiquetaMax, r.ath, r.athApprox, ayudaMax, 'rng-ath')}
    ${cell('Mínimo ' + y, r.low)}
  </div>`;
}

export function coinRow(c, index) {
  const change = c.dayChangePct;
  return `<tr data-symbol="${esc(c.symbol)}" class="clickable">
    <td class="coin-cell" data-label="Moneda">
      <div class="coin">${coinBadge(c.symbol)}
        <div class="coin-name"><b>${esc(c.symbol)}</b></div>
        ${rngBlock(c.symbol)}
      </div>
    </td>
    <td class="num" data-label="Cantidad">${num(c.amount, 8)}</td>
    <td class="num" data-label="Precio">${priceFmt(c.price)}</td>
    <td class="num" data-label="P. medio">${c.costKnown ? priceFmt(c.avgPrice) : '<span class="muted">n/d</span>'}</td>
    <td class="num" data-label="Valor"><b>${eur(c.value)}</b></td>
    <td class="num" data-label="Invertido">${c.costKnown ? eur(c.invested) : '<span class="muted">n/d</span>'}</td>
    <td class="num ${c.pnl === null ? '' : signed(c.pnl)}" data-label="P/L">${c.pnl === null ? '<span class="muted">n/d</span>' : `<b>${c.pnl >= 0 ? '+' : ''}${eur(c.pnl)}</b><br><small>${pct(c.pnlPct)}</small>`}</td>
    <td class="num ${signed(change || 0)}" data-label="Hoy">${change === null || change === undefined ? '—' : pct(change)}</td>
    <td class="num spark-cell" data-label="7 días">${sparklineSvg(state.sparklines[c.symbol])}</td>
  </tr>`;
}
