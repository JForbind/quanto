'use strict';
// Vista Fiscal: informe FIFO por ejercicio, gráficos y exportación a Excel.
import { $, $$, state, api, toast, eur, eur0, num, pct, priceFmt, signed, dateShort, esc } from '../core.js';
import { chart, themeVars, baseTooltip } from '../ui/charts.js';

export async function loadTax() {
  const empty = $('#tax-empty');
  const content = $('#tax-content');
  try {
    const data = await api('/api/tax?year=' + encodeURIComponent(state.taxYear));
    if (!data.ok) {
      empty.classList.remove('hidden');
      content.classList.add('hidden');
      return;
    }
    state.tax = data;
    empty.classList.add('hidden');
    content.classList.remove('hidden');
    renderTax();
  } catch (e) {
    toast('No se pudo cargar el informe fiscal: ' + e.message, true);
  }
}

function renderTax() {
  const t = state.tax;
  if (!t) return;
  const years = t.years || [];
  const sel = state.taxYear === 'all' ? null : years.find(y => String(y.year) === String(state.taxYear));
  const gain = sel ? sel.gain : t.totals.gain;
  const tax = sel ? sel.tax : years.reduce((a, y) => a + (y.tax || 0), 0);
  const count = sel ? sel.count : t.totals.count;
  const losses = years.filter(y => y.gain < 0).reduce((a, y) => a + -y.gain, 0);

  $('#tax-gain').textContent = (gain >= 0 ? '+' : '') + eur(gain);
  $('#tax-gain').className = 'kpi-value ' + signed(gain);
  $('#tax-gain-sub').textContent = sel ? 'ejercicio ' + sel.year : years.length + ' ejercicio(s) con ventas';
  $('#tax-quota').textContent = tax > 0 ? eur(tax) : eur(0);
  $('#tax-quota-sub').textContent = gain < 0 ? 'si el resultado es pérdida, no hay cuota' : 'estimada sobre la base del ahorro';
  $('#tax-count').textContent = count;
  $('#tax-count-sub').textContent = 'ventas registradas';
  $('#tax-loss').textContent = losses > 0 ? eur(losses) : '—';
  $('#tax-loss-sub').textContent = 'compensables 4 ejercicios';

  const yearsEl = $('#tax-years');
  yearsEl.innerHTML = [`<button data-year="all" class="${state.taxYear === 'all' ? 'is-active' : ''}">Todos</button>`]
    .concat(years.map(y => `<button data-year="${y.year}" class="${String(state.taxYear) === String(y.year) ? 'is-active' : ''}">${y.year}</button>`)).join('');
  yearsEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.taxYear = b.dataset.year; loadTax(); }));

  const warning = $('#tax-warning');
  const unmatched = t.totals.unmatchedProceeds || 0;
  if (unmatched > 0.5) {
    warning.classList.remove('hidden');
    warning.className = 'banner';
    warning.innerHTML = `<span>⚠️</span><span>Hay <b>${eur(unmatched)}</b> en ventas sin compra registrada: su coste es 0 y la ganancia saldría inflada. Revisa esas filas (marcadas <b>sin coste</b>) antes de declarar.</span>`;
  } else {
    warning.classList.add('hidden');
  }

  const rows = (sel ? sel.disposals : years.flatMap(y => y.disposals)).slice().sort((a, b) => b.ts - a.ts);
  $('#tax-table-sub').textContent = sel ? 'ejercicio ' + sel.year : 'todos los ejercicios';
  $('#tax-tbody').innerHTML = rows.length ? rows.map(d => `<tr>
    <td>${dateShort(d.ts)}</td>
    <td><b>${esc(d.symbol)}</b></td>
    <td class="num">${num(d.amount, 8)}</td>
    <td class="num">${priceFmt(d.price)}</td>
    <td class="num">${eur(d.proceeds)}</td>
    <td class="num">${d.unmatchedAmount > 0 ? `<span class="warn" title="Sin compra registrada">${eur(d.cost)} *</span>` : eur(d.cost)}</td>
    <td class="num ${signed(d.gain)}"><b>${(d.gain >= 0 ? '+' : '') + eur(d.gain)}</b></td>
  </tr>`).join('') : '<tr><td colspan="7" class="empty">Todavía no has vendido nada: no hay transmisiones que declarar.</td></tr>';
  $('#tax-foot').textContent = `Transmisión ${eur(t.totals.proceeds)} · adquisición ${eur(t.totals.cost)} · resultado ${eur(t.totals.gain)}`;

  $('#tax-summary-body').innerHTML = years.map(y => `<tr>
    <td><b>${y.year}</b></td>
    <td class="num">${y.count}</td>
    <td class="num ${signed(y.gain)}">${(y.gain >= 0 ? '+' : '') + eur(y.gain)}</td>
    <td class="num">${y.tax > 0 ? eur(y.tax) : '—'}</td>
  </tr>`).join('') || '<tr><td colspan="4" class="empty">Sin datos</td></tr>';

  const brackets = $('#tax-brackets');
  if (brackets) {
    const list = t.brackets || [];
    const rows = list.map((b, i) => {
      const from = i === 0 ? 0 : list[i - 1].upTo;
      return `<span class="bracket"><b>${num(b.rate * 100, 0)} %</b> ${from ? 'de ' + num(from) + ' a ' : 'hasta '}${num(b.upTo)} €</span>`;
    });
    brackets.innerHTML = `<p class="hint" style="margin:0 0 8px"><strong>Tramos de la base del ahorro</strong></p><div class="bracket-list">${rows.join('')}</div>`;
  }

  $('#tax-inv-sub').textContent = `coste ${eur(t.totals.inventoryCost)} · valor ${eur(t.totals.inventoryValue)}`;
  $('#tax-inventory-body').innerHTML = (t.inventory || []).map(i => `<tr>
    <td><b>${esc(i.symbol)}</b></td>
    <td class="num">${num(i.amount, 8)}</td>
    <td class="num">${eur(i.cost)}</td>
    <td class="num">${i.hasPrice === false ? '<span class="muted">sin precio</span>' : eur(i.value)}</td>
    <td class="num ${i.pnl === null ? '' : signed(i.pnl)}">${i.pnl === null ? '<span class="muted">—</span>' : (i.pnl >= 0 ? '+' : '') + eur(i.pnl)}</td>
    <td class="num ${i.sellTax === null || i.sellTax === undefined ? '' : (i.sellGain < 0 ? 'pos' : '')}">${i.sellTax === null || i.sellTax === undefined ? '<span class="muted">—</span>' : eur(i.sellTax)}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty">Sin inventario</td></tr>';

  const sel2 = $('#tax-sim-symbol');
  sel2.innerHTML = (t.inventory || []).map(i => `<option value="${esc(i.symbol)}">${esc(i.symbol)} · ${num(i.amount, 4)}</option>`).join('');
}

$('#tax-export')?.addEventListener('click', () => {
  location.href = '/api/export/tax.xlsx' + (state.taxYear !== 'all' ? '?year=' + state.taxYear : '');
});
$('#export-tax-shortcut')?.addEventListener('click', () => { location.href = '/api/export/tax.xlsx'; });

let simTimer = null;
$('#tax-sim-amount')?.addEventListener('input', () => { clearTimeout(simTimer); simTimer = setTimeout(runSimulation, 400); });
$('#tax-sim-symbol')?.addEventListener('change', runSimulation);
$$('#tax-sim-quick button').forEach(b => b.addEventListener('click', () => {
  const inv = (state.tax.inventory || []).find(i => i.symbol === $('#tax-sim-symbol').value);
  if (!inv) return;
  $('#tax-sim-amount').value = (inv.amount * (Number(b.dataset.pct) / 100)).toFixed(8);
  runSimulation();
}));

async function runSimulation() {
  const out = $('#tax-sim-result');
  const symbol = $('#tax-sim-symbol').value;
  const amount = Number($('#tax-sim-amount').value);
  if (!symbol || !(amount > 0)) { out.className = 'sim-result muted'; out.textContent = 'Elige una moneda y una cantidad.'; return; }
  try {
    const r = await api(`/api/tax/simulate?symbol=${encodeURIComponent(symbol)}&amount=${amount}`);
    if (!r.ok) { out.textContent = r.message || 'Sin datos'; return; }
    out.className = 'sim-result';
    out.innerHTML = `
      <div class="row"><span>Precio actual</span><b>${priceFmt(r.price)}</b></div>
      <div class="row"><span>Ingreso por la venta</span><b>${eur(r.proceeds)}</b></div>
      <div class="row"><span>Ganancia con FIFO</span><b class="${signed(r.fifo.gain)}">${(r.fifo.gain >= 0 ? '+' : '') + eur(r.fifo.gain)}</b></div>
      <div class="row"><span>Ganancia con coste medio</span><b class="${signed(r.average.gain)}">${(r.average.gain >= 0 ? '+' : '') + eur(r.average.gain)}</b></div>
      <div class="row"><span>Cuota estimada (FIFO)</span><b>${eur(r.fifo.tax)}</b></div>
      <div class="row"><span>Te quedarían</span><b>${eur(r.netAfterTax)}</b></div>
      ${r.unmatched > 0 ? `<div class="row"><span class="warn">Sin compra registrada</span><b class="warn">${num(r.unmatched, 8)} ${esc(symbol)}</b></div>` : ''}
      <div class="row"><span>Queda en cartera</span><b>${num(r.remaining, 8)} ${esc(symbol)} · ${eur(r.remainingValue)}</b></div>
      ${r.weightBefore !== null && r.weightAfter !== null ? `<div class="row"><span>Peso en cartera</span><b>${num(r.weightBefore, 1)} % → ${num(r.weightAfter, 1)} %</b></div>` : ''}`;
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}
