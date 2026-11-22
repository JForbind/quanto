'use strict';
// Vista de Operaciones: listado, filtros, búsqueda y exportaciones.
import { $, $$, state, esc, eur, num, priceFmt, dateTime } from '../core.js';
import { coinBadge } from '../ui/coins.js';

export function renderOperations() {
  const tbody = $('#ops-tbody');
  if (!tbody) return;
  let rows = state.transactions;
  if (state.opsFilter !== 'all') rows = rows.filter(t => t.type === state.opsFilter);
  const q = state.opsQuery.trim().toLowerCase();
  if (q) rows = rows.filter(t => t.symbol.toLowerCase().includes(q) || t.label.toLowerCase().includes(q));
  const total = rows.length;
  rows = rows.slice(0, state.opsLimit);
  $('#ops-count').textContent = `${rows.length} de ${total} operaciones`;
  $('#ops-more').classList.toggle('hidden', rows.length >= total);
  $('#ops-empty').classList.toggle('hidden', total > 0);
  tbody.innerHTML = rows.map(t => `<tr>
    <td>${dateTime(t.ts)}</td>
    <td><span class="pill ${esc(t.type)}">${esc(t.label)}</span></td>
    <td><div class="coin" style="gap:8px">${coinBadge(t.symbol)}<b>${esc(t.symbol)}</b></div></td>
    <td class="num">${num(t.amount, 8)}</td>
    <td class="num">${t.price ? priceFmt(t.price) : '—'}</td>
    <td class="num">${t.value ? eur(t.value) : '—'}</td>
    <td class="num muted">${t.fee ? num(t.fee, 8) + ' ' + esc(t.feeCurrency || '') : '—'}</td>
  </tr>`).join('');
}

export function initOperations() {
  $$('#ops-filters button').forEach(b => b.addEventListener('click', () => {
    $$('#ops-filters button').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
    state.opsFilter = b.dataset.type;
    state.opsLimit = 60;
    renderOperations();
  }));
  $('#ops-search')?.addEventListener('input', (e) => { state.opsQuery = e.target.value; renderOperations(); });
  $('#ops-more')?.addEventListener('click', () => { state.opsLimit += 100; renderOperations(); });
  $('#ops-export-xlsx')?.addEventListener('click', () => { location.href = '/api/export/transactions.xlsx'; });
  $('#ops-export-csv')?.addEventListener('click', () => { location.href = '/api/transactions.csv'; });
}
