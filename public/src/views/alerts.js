'use strict';
// Vista de Alertas: formulario, lista, edición y comprobación manual.
import { $, esc, api, toast, num, priceFmt, state } from '../core.js';

// La app inyecta el icono de moneda y el pintado del bloque de Telegram.
let coinBadge = () => '';
let renderTelegram = () => {};

export function initAlerts(deps = {}) {
  if (typeof deps.coinBadge === 'function') coinBadge = deps.coinBadge;
  if (typeof deps.renderTelegram === 'function') renderTelegram = deps.renderTelegram;
}

/* ------------------------------------------------ alertas */
export async function renderAlertsView() {
  const sel = $('#alert-symbol');
  const coins = (state.portfolio && state.portfolio.coins) || [];
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = coins.map(c => `<option value="${esc(c.symbol)}">${esc(c.symbol)}</option>`).join('');
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  }
  updateAlertHint();
  try {
    const data = await api('/api/alerts');
    state.alerts = data;
    renderTelegram(data.telegram || {});
    renderAlertsList(data.rules || []);
  } catch (e) {
    toast(e.message, true);
  }
}

function updateAlertHint() {
  const hint = $('#alert-hint');
  const sel = $('#alert-symbol');
  if (!hint || !sel) return;
  const coin = ((state.portfolio && state.portfolio.coins) || []).find(c => c.symbol === sel.value);
  if (!coin) { hint.textContent = 'No hay monedas en la cartera.'; return; }
  const above = ($('#alert-op') || {}).value === 'above';
  hint.innerHTML = `Precio actual de <b>${esc(coin.symbol)}</b>: <b>${priceFmt(coin.price)}</b>`
    + (coin.costKnown && coin.avgPrice ? ` · tu precio medio: ${priceFmt(coin.avgPrice)}` : '')
    + `. Escribe un precio ${above ? 'por encima' : 'por debajo'} de ese valor para que te avise.`;
}


function renderAlertsList(rules) {
  const box = $('#alerts-list');
  if (!box) return;
  if (!rules.length) {
    box.innerHTML = '<p class="empty">Sin alertas todavía. Crea la primera arriba.</p>';
    return;
  }
  const coins = (state.portfolio && state.portfolio.coins) || [];
  box.innerHTML = rules.map(r => {
    const coin = coins.find(c => c.symbol === r.symbol);
    const price = coin ? coin.price : null;
    const avg = coin && coin.costKnown ? coin.avgPrice : null;
    const gapPct = price ? ((r.price - price) / price) * 100 : null;
    let gapTxt = '';
    if (gapPct !== null) {
      const yaCumple = r.op === 'above' ? gapPct <= 0 : gapPct >= 0;
      gapTxt = yaCumple
        ? (r.op === 'above' ? 'ya está por encima' : 'ya está por debajo')
        : `faltan ${num(Math.abs(gapPct), 1)} %`;
    }
    const estado = r.lastError ? 'error' : (r.armed === false ? 'disparada' : 'armada');
    const chipCls = r.lastError ? ' chip-err' : (r.armed === false ? ' chip-warn' : ' chip-ok');
    return `<div class="alert-row ${r.enabled === false ? 'is-off' : ''}">
      <div class="alert-main alert-coin">${coinBadge(r.symbol)}<b>${esc(r.symbol)}</b></div>
      <div class="alert-cell opt"><span>Condición</span><b>${r.op === 'above' ? 'máximo' : 'mínimo'}</b></div>
      <div class="alert-cell"><span>Precio fijado</span><b>${priceFmt(r.price)}</b></div>
      <div class="alert-cell opt"><span>Tu media</span><b>${avg ? priceFmt(avg) : '—'}</b></div>
      <div class="alert-cell right"><span>Ahora</span><b>${price === null ? '—' : priceFmt(price)}</b><small>${gapTxt}</small></div>
      <span class="chips-alert">
        <span class="chip${chipCls}">${estado}</span>
        ${r.planId ? '<span class="chip chip-plan" title="Creada automáticamente por un plan de inversión">plan</span>' : ''}
      </span>
      <div class="alert-actions">
        <button class="btn btn-ghost btn-xs" data-alert-edit="${esc(r.id)}" title="Editar esta alerta">✏️ Editar</button>
        <button class="btn btn-ghost btn-xs" data-alert-test="${esc(r.id)}" title="Enviar este aviso ahora a Telegram">🔔 Probar</button>
        <button class="btn btn-ghost btn-xs" data-alert-toggle="${esc(r.id)}">${r.enabled === false ? '▶️ Activar' : '⏸️ Pausar'}</button>
        <button class="btn btn-ghost btn-xs btn-danger-ghost" data-alert-del="${esc(r.id)}" title="Borrar esta alerta">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function refreshAlertsList() {
  try {
    const data = await api('/api/alerts');
    state.alerts = data;
    renderTelegram(data.telegram || {});
    renderAlertsList(data.rules || []);
  } catch (e) { toast(e.message, true); }
}

/* --- edición de alertas --- */
let editingAlertId = null;

function fillAlertForm(rule) {
  editingAlertId = rule.id;
  $('#alert-symbol').value = rule.symbol;
  $('#alert-op').value = rule.op === 'above' ? 'above' : 'below';
  $('#alert-price').value = rule.price;
  const btn = $('#alert-submit');
  if (btn) btn.textContent = 'Guardar cambios';
  const cancel = $('#alert-cancel');
  if (cancel) cancel.classList.remove('hidden');
  const title = $('#alert-form-title');
  if (title) title.textContent = 'Editar alerta';
  updateAlertHint();
  const form = $('#alert-form');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetAlertForm() {
  editingAlertId = null;
  const price = $('#alert-price');
  if (price) price.value = '';
  const btn = $('#alert-submit');
  if (btn) btn.textContent = 'Añadir alerta';
  const cancel = $('#alert-cancel');
  if (cancel) cancel.classList.add('hidden');
  const title = $('#alert-form-title');
  if (title) title.textContent = 'Nueva alerta';
  const out = $('#alert-result');
  if (out) { out.textContent = ''; out.className = 'result'; }
}

$('#alert-cancel')?.addEventListener('click', () => resetAlertForm());

$('#alert-symbol')?.addEventListener('change', updateAlertHint);
$('#alert-op')?.addEventListener('change', updateAlertHint);

$('#alert-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#alert-result');
  try {
    const symbol = $('#alert-symbol').value;
    const op = ($('#alert-op') || {}).value === 'above' ? 'above' : 'below';
    const price = Number(String($('#alert-price').value).replace(',', '.'));
    const body = { symbol, price, op };
    if (editingAlertId) body.id = editingAlertId;
    const wasEditing = !!editingAlertId;
    await api('/api/alerts', { method: 'POST', body: JSON.stringify(body) });
    if (out) {
      out.className = 'result ok';
      const coin = ((state.portfolio && state.portfolio.coins) || []).find(c => c.symbol === symbol);
      const already = coin && (op === 'below' ? coin.price <= price : coin.price >= price);
      out.textContent = `${wasEditing ? 'Alerta actualizada' : 'Alerta creada'}: ${symbol} ${op === 'above' ? 'por encima' : 'por debajo'} de ${priceFmt(price)}.`
        + (already ? ' Ojo: ya cumple la condición ahora mismo, se disparará en la próxima comprobación.' : '');
    }
    resetAlertForm();
    await refreshAlertsList();
    toast(wasEditing ? 'Alerta actualizada' : 'Alerta creada');
  } catch (err) {
    if (out) { out.className = 'result err'; out.textContent = err.message; }
    toast(err.message, true);
  }
});

$('#alert-preview')?.addEventListener('click', async () => {
  const out = $('#alert-result');
  try {
    const symbol = $('#alert-symbol').value;
    const op = ($('#alert-op') || {}).value === 'above' ? 'above' : 'below';
    const price = Number(String($('#alert-price').value).replace(',', '.'));
    const qs = new URLSearchParams({ symbol, op });
    if (price > 0) qs.set('price', String(price));
    const r = await api('/api/alerts/preview?' + qs.toString());
    out.className = 'result ok';
    // Mostramos el mensaje tal y como lo verá Telegram (negritas y cursivas), sin el HTML crudo.
    const safe = esc(r.text)
      .replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')
      .replace(/&lt;i&gt;/g, '<i>').replace(/&lt;\/i&gt;/g, '</i>');
    out.innerHTML = `<div class="alert-preview">${safe}</div>`;
  } catch (err) {
    out.className = 'result err';
    out.textContent = err.message;
  }
});

$('#alerts-check')?.addEventListener('click', async () => {
  const btn = $('#alerts-check');
  btn.disabled = true;
  try {
    const r = await api('/api/alerts/check', { method: 'POST', body: '{}' });
    if (r.reason === 'telegram-sin-configurar') toast('Configura primero Telegram', true);
    else if (r.reason === 'sin-alertas') toast('No hay alertas activas', true);
    else toast(r.fired && r.fired.length ? `${r.fired.length} aviso(s) enviados` : 'Ninguna alerta se ha disparado');
    await refreshAlertsList();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; }
});

$('#alerts-list')?.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-alert-del]');
  const toggle = e.target.closest('[data-alert-toggle]');
  const edit = e.target.closest('[data-alert-edit]');
  const test = e.target.closest('[data-alert-test]');
  try {
    if (edit) {
      const rule = ((state.alerts && state.alerts.rules) || []).find(r => r.id === edit.dataset.alertEdit);
      if (rule) fillAlertForm(rule);
      return;
    }
    if (test) {
      const btn = test;
      btn.disabled = true;
      try {
        await api('/api/alerts/' + test.dataset.alertTest + '/test', { method: 'POST', body: '{}' });
        toast('Aviso enviado a Telegram');
      } finally { btn.disabled = false; }
      return;
    }
    if (del) {
      await api('/api/alerts/' + del.dataset.alertDel, { method: 'DELETE' });
      if (editingAlertId === del.dataset.alertDel) resetAlertForm();
      await refreshAlertsList();
      toast('Alerta borrada');
    } else if (toggle) {
      await api('/api/alerts/' + toggle.dataset.alertToggle + '/toggle', { method: 'POST', body: '{}' });
      await refreshAlertsList();
    }
  } catch (err) { toast(err.message, true); }
});
