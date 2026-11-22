'use strict';
// Vista de Planes de inversión: tramos, progreso y sincronización con Bitvavo.
import { $, esc, api, toast, num, eur, priceFmt, state } from '../core.js';

state.plans = state.plans || [];
state.planPrices = state.planPrices || {};

// La app inyecta cómo se obtiene la lista de monedas (cartera + seguimiento).
let getSymbols = () => [];

export function initPlans(deps = {}) {
  if (typeof deps.tradeSymbols === 'function') getSymbols = deps.tradeSymbols;
  document.addEventListener('click', onPlanClick);
}

function planTrancheRow(price, amount) {
  const row = document.createElement('div');
  row.className = 'plan-tranche-row';
  row.innerHTML = `
    <label class="field"><span>Precio (€)</span><input type="number" step="any" min="0" class="pt-price" placeholder="0,00" value="${price ?? ''}"></label>
    <label class="field"><span>Importe (€)</span><input type="number" step="any" min="0" class="pt-amount" placeholder="0" value="${amount ?? ''}"></label>
    <button class="icon-btn pt-del" type="button" title="Quitar tramo" aria-label="Quitar tramo">×</button>`;
  row.querySelector('.pt-del').addEventListener('click', () => {
    const box = $('#plan-tranches');
    if (box && box.children.length > 1) row.remove();
  });
  return row;
}

function renderPlanForm() {
  const box = $('#plan-tranches');
  if (!box || box.dataset.ready === '1') return;
  box.dataset.ready = '1';
  box.appendChild(planTrancheRow('', ''));
  const sel = $('#plan-symbol');
  const syms = getSymbols();
  sel.innerHTML = syms.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  $('#plan-add-tranche').addEventListener('click', () => box.appendChild(planTrancheRow('', '')));
  $('#plan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const symbol = sel.value;
    const title = $('#plan-title').value.trim();
    const tranches = [...box.querySelectorAll('.plan-tranche-row')].map(r => ({
      price: Number(r.querySelector('.pt-price').value),
      amount: Number(r.querySelector('.pt-amount').value),
    })).filter(x => x.price > 0 && x.amount > 0);
    if (!symbol || !tranches.length) { toast('Añade al menos un tramo con precio e importe', true); return; }
    try {
      await api('/api/plans', { method: 'POST', body: JSON.stringify({ symbol, title, tranches }) });
      box.innerHTML = '';
      box.appendChild(planTrancheRow('', ''));
      $('#plan-title').value = '';
      await loadPlans();
      toast('Plan creado');
    } catch (err) { toast(err.message, true); }
  });
}

function planCard(plan) {
  const price = Number(state.planPrices[plan.symbol]) || 0;
  const done = plan.tranches.filter(x => x.status === 'done');
  const spent = done.reduce((a, x) => a + x.amount, 0);
  const pct = plan.budget > 0 ? Math.round((spent / plan.budget) * 100) : 0;
  const rows = plan.tranches.map(x => {
    const dist = price > 0 && x.status === 'pending' ? ((x.price - price) / price) * 100 : null;
    const distTxt = dist === null ? '' : dist >= 0
      ? '<span class="pos">ya está en precio</span>'
      : `<span class="muted">faltan ${num(Math.abs(dist), 1)} %</span>`;
    return `<div class="plan-row ${x.status}">
      <span class="pr-price">${priceFmt(x.price)}</span>
      <span class="pr-amount">${eur(x.amount)}</span>
      <span class="pr-state">${x.status === 'done' ? `ejecutado${x.donePrice ? ' · ' + priceFmt(x.donePrice) : ''}` : x.status === 'cancelled' ? 'cancelado' : distTxt}</span>
      <span class="pr-actions">
        ${x.status === 'pending'
          ? `<button class="btn btn-ghost btn-xs" data-plan="${plan.id}" data-tr="${x.id}" data-st="done">Ejecutar</button>
             <button class="btn btn-ghost btn-xs" data-plan="${plan.id}" data-tr="${x.id}" data-st="cancelled">Cancelar</button>`
          : `<button class="btn btn-ghost btn-xs" data-plan="${plan.id}" data-tr="${x.id}" data-st="pending">Reabrir</button>`}
      </span>
    </div>`;
  }).join('');
  return `<article class="card glass plan-card">
    <header class="card-head">
      <div><h2>${esc(plan.symbol)}${plan.title ? ' · ' + esc(plan.title) : ''}</h2>
        <p class="card-sub">Presupuesto ${eur(plan.budget)} · gastado ${eur(spent)} (${pct} %) · avisos de Telegram por tramo pendiente</p></div>
      <div class="plan-head-actions">
        <button class="btn btn-ghost btn-xs" data-plan-report="${plan.id}" title="Ver el informe del plan">Informe</button>
        <button class="icon-btn" data-plan-del="${plan.id}" title="Borrar plan" aria-label="Borrar plan">×</button>
      </div>
    </header>
    <div class="plan-progress"><span style="width:${Math.min(100, pct)}%"></span></div>
    <div class="plan-rows">${rows}</div>
  </article>`;
}

async function loadPlans() {
  try {
    const r = await api('/api/plans');
    state.plans = r.plans || [];
    state.planPrices = r.prices || {};
    renderPlans();
  } catch (e) { toast(e.message, true); }
}

async function syncBitvavoPlansUi(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando…'; }
  try {
    const r = await api('/api/plans/bitvavo-sync', { method: 'POST' });
    await loadPlans();
    const bits = [];
    if (r.tramosNuevos) bits.push(`${r.tramosNuevos} tramos nuevos`);
    if (r.tramosCerrados) bits.push(`${r.tramosCerrados} cerrados`);
    toast(bits.length ? 'Bitvavo: ' + bits.join(' · ') : 'Bitvavo: no hay cambios', 'ok');
  } catch (e) {
    toast('No se pudo consultar Bitvavo: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Traer órdenes de Bitvavo'; }
  }
}

function renderPlans() {
  const bvBtn = $('#plans-bitvavo');
  if (bvBtn && !bvBtn.dataset.ready) {
    bvBtn.dataset.ready = '1';
    bvBtn.addEventListener('click', () => syncBitvavoPlansUi(bvBtn));
  }
  const box = $('#plans-list');
  if (!box) return;
  if (!state.plans.length) {
    box.innerHTML = '<p class="empty muted">Todavía no tienes planes. Crea el primero arriba.</p>';
    return;
  }
  box.innerHTML = state.plans.map(planCard).join('');
}

export function renderPlansView() {
  renderPlanForm();
  loadPlans();
}

async function onPlanClick(e) {
  const del = e.target.closest('[data-plan-del]');
  const btn = e.target.closest('[data-plan][data-tr]');
  try {
    if (del) {
      await api('/api/plans/' + del.dataset.planDel, { method: 'DELETE' });
      await loadPlans();
      toast('Plan borrado');
      return;
    }
    if (btn) {
      await api(`/api/plans/${btn.dataset.plan}/tranche/${btn.dataset.tr}`, {
        method: 'POST', body: JSON.stringify({ status: btn.dataset.st }),
      });
      await loadPlans();
      toast(btn.dataset.st === 'done' ? 'Tramo marcado como ejecutado' : 'Tramo actualizado');
    }
  } catch (err) { toast(err.message, true); }
}
