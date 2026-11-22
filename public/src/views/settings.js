'use strict';
// Ajustes: claves de Bitvavo, canales de aviso, importación, wallet fría y «Acerca de».
import { $, state, api, toast, esc, eur, num, dateShort, dateLong, dateTime } from '../core.js';
import { renderDashboard } from './dashboard.js';

// La app inyecta las recargas que viven en app.js.
let hooks = {};
export function initSettings(d = {}) {
  hooks = d;
}

export function loadSettingsView() {
  renderSettings();
  renderImportStatus();
  renderColdList();
  renderAbout();
}

export function renderSettings() {
  const s = state.settings || {};
  const chip = $('#keys-status');
  if (chip) {
    const live = state.status && state.status.mode === 'live';
    chip.textContent = live ? 'Conectado' : (s.apiKeySet ? 'Claves guardadas' : 'Sin conectar');
    chip.className = 'chip' + (live ? ' chip-mode live' : '');
  }
  const pass = $('#pass-status');
  if (pass) pass.textContent = s.hasPassword ? 'Protegido' : 'Sin contraseña';
  const wk = $('#tg-weekly');
  if (wk && s.weekly) wk.checked = !!s.weekly.enabled;
  if (s.apiKeyMasked) $('#set-apikey').placeholder = s.apiKeyMasked;
  const keysForm = $('#keys-form');
  if (keysForm) {
    $('#keys-sync').disabled = !(state.status && state.status.mode === 'live');
  }
}

export function renderImportStatus() {
  const el = $('#import-status');
  if (!el) return;
  const st = state.status || {};
  if (st.importedAt) {
    el.textContent = 'Importado';
    el.className = 'chip chip-mode live';
  } else if (st.ops) {
    el.textContent = 'Solo API (parcial)';
    el.className = 'chip chip-mode demo';
  } else {
    el.textContent = 'Sin historial';
    el.className = 'chip';
  }
}

export function renderColdList() {
  const ul = $('#cold-list');
  if (!ul) return;
  const entries = Object.entries(state.cold || {});
  ul.innerHTML = entries.length ? entries.map(([sym, v]) => `<li>
    <b>${esc(sym)}</b>
    <span class="grow muted">${num(v.amount, 8)}${v.invested ? ' · ' + eur(v.invested) : ''}</span>
    <button data-cold="${esc(sym)}" title="Quitar">×</button>
  </li>`).join('') : '<li class="muted">Sin monedas manuales.</li>';
  ul.querySelectorAll('button[data-cold]').forEach(b => b.addEventListener('click', async () => {
    try {
      state.cold = await api('/api/holdings/' + encodeURIComponent(b.dataset.cold), { method: 'DELETE' });
      renderColdList();
      state.portfolio = await api('/api/portfolio?force=1');
      renderDashboard();
      toast('Eliminado');
    } catch (e) { toast(e.message, true); }
  }));
}

export function renderAbout() {
  const el = $('#about');
  const st = state.status || {};
  if (!el) return;
  el.innerHTML = [
    ['Versión', st.version || '—'],
    ['Modo', st.mode === 'live' ? 'LIVE (claves conectadas)' : 'DEMO'],
    ['Operaciones', st.ops || 0],
    ['Historial importado', st.importedAt ? dateLong(st.importedAt) : 'No'],
    ['Última sincronización', st.lastSyncAt ? dateTime(st.lastSyncAt) : '—'],
    ['Copias automáticas', 'en data/ junto a los JSON'],
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

$('#keys-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('#set-apikey').value.trim();
  const secret = $('#set-apisecret').value.trim();
  if (!key || !secret) { toast('Rellena la API Key y el Secret', true); return; }
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ apiKey: key, apiSecret: secret }) });
    $('#set-apikey').value = '';
    $('#set-apisecret').value = '';
    toast('Claves guardadas. Sincronizando…');
    const sync = await api('/api/sync', { method: 'POST' });
    state.status = null;
    if (hooks.loadOverview) await hooks.loadOverview(true);
    loadSettingsView();
    toast(sync.added ? `Sincronizadas ${sync.added} operaciones nuevas` : 'Sin operaciones nuevas');
  } catch (e2) { toast(e2.message, true); }
});

$('#keys-sync')?.addEventListener('click', async () => {
  const btn = $('#keys-sync');
  btn.disabled = true;
  try {
    const r = await api('/api/sync', { method: 'POST' });
    if (hooks.loadOverview) await hooks.loadOverview(true);
    toast(r.added ? `${r.added} operaciones nuevas` : 'Todo al día');
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
});

$('#keys-clear')?.addEventListener('click', async () => {
  if (!confirm('¿Borrar las claves de Bitvavo?')) return;
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ apiKey: '', apiSecret: '', clearKeys: true }) });
    if (hooks.loadOverview) await hooks.loadOverview(true);
    loadSettingsView();
    toast('Claves borradas');
  } catch (e) { toast(e.message, true); }
});

$('#password-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#pass-result');
  out.className = 'result';
  out.textContent = '';
  const next = $('#pass-new').value;
  if (next !== $('#pass-repeat').value) { out.className = 'result err'; out.textContent = 'Las contraseñas no coinciden.'; return; }
  try {
    await api('/api/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('#pass-current').value, newPassword: next }) });
    out.className = 'result ok';
    out.textContent = 'Contraseña cambiada.';
    setTimeout(() => location.reload(), 1200);
  } catch (e2) {
    out.className = 'result err';
    out.textContent = (e2.data && e2.data.problems) ? 'Falta: ' + e2.data.problems.join(', ') : e2.message;
  }
});

/* importación de historial */
let pendingCsv = null;
const drop = $('#drop-zone');
const fileInput = $('#history-file');

function setDropName(name) {
  $('#drop-name').textContent = name || 'Sin archivo';
}
fileInput?.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  setDropName(f ? f.name : null);
  pendingCsv = f || null;
});
['dragenter', 'dragover'].forEach(ev => drop?.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => drop?.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop?.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  pendingCsv = f;
  setDropName(f.name);
});

async function importHistoryText(text) {
  const out = $('#import-result');
  out.className = 'result';
  out.textContent = 'Importando…';
  try {
    const r = await api('/api/import/history', { method: 'POST', body: JSON.stringify({ text }) });
    out.className = 'result ok';
    out.innerHTML = `✅ <b>${r.ops}</b> operaciones · <b>${r.coins}</b> monedas · <b>${r.sells}</b> ventas<br>
      <b>${r.added}</b> nuevas · <b>${Math.max(0, r.ops - r.added)}</b> ya estaban (no se ha borrado nada)${r.backup ? `<br><span class="muted tiny">Copia previa guardada: .bak-${r.backup}</span>` : ''}<br>
      Desde ${dateShort(r.from)} hasta ${dateShort(r.to)}<br>
      Comprado ${eur(r.bought)} · vendido ${eur(r.sold)}${r.unmatched > 0 ? `<br><span class="warn">⚠️ ${eur(r.unmatched)} en ventas sin compra registrada</span>` : ''}`;
    state.evolution = null;
    state.tax = null;
    if (hooks.loadOverview) await hooks.loadOverview(true);
    if (hooks.loadTransactions) await hooks.loadTransactions();
    if (state.view === 'tax') loadTax();
    toast('Historial importado');
  } catch (e) {
    out.className = 'result err';
    out.textContent = '❌ ' + e.message;
  }
}

$('#history-import')?.addEventListener('click', async () => {
  const btn = $('#history-import');
  btn.disabled = true;
  try {
    let text = null;
    const pasted = $('#history-text').value.trim();
    if (pendingCsv) text = await pendingCsv.text();
    else if (pasted) text = pasted;
    if (!text) { toast('Elige un archivo o pega el CSV', true); return; }
    await importHistoryText(text);
  } finally {
    btn.disabled = false;
  }
});

$('#history-paste-btn')?.addEventListener('click', () => {
  const text = $('#history-text').value.trim();
  if (!text) { toast('Pega primero el CSV', true); return; }
  importHistoryText(text);
});

/* datos */
$('#restore-file')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  const out = $('#data-result');
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const r = await api('/api/restore', { method: 'POST', body: JSON.stringify({ backup }) });
    out.className = 'result ok';
    out.textContent = '✅ Restaurado: ' + r.restored.join(', ');
    state.evolution = null;
    state.tax = null;
    if (hooks.boot) await hooks.boot();
  } catch (err) {
    out.className = 'result err';
    out.textContent = '❌ ' + err.message;
  }
});

$('#wipe-btn')?.addEventListener('click', async () => {
  const word = prompt('Esto borra historial, wallet fría y datos. Escribe BORRAR para confirmar:');
  if (word !== 'BORRAR') return;
  try {
    const r = await api('/api/wipe', { method: 'POST', body: JSON.stringify({ confirm: 'BORRAR' }) });
    toast('Datos borrados (copia .bak-' + r.backupSuffix + ')');
    state.evolution = null;
    state.tax = null;
    state.transactions = [];
    if (hooks.boot) await hooks.boot();
  } catch (e) { toast(e.message, true); }
});

/* wallet fría */
$('#cold-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const symbol = $('#cold-symbol').value.trim().toUpperCase();
  const amount = Number($('#cold-amount').value);
  const invested = $('#cold-invested').value;
  if (!symbol || !(amount >= 0)) { toast('Indica moneda y cantidad', true); return; }
  try {
    state.cold = await api('/api/holdings', { method: 'POST', body: JSON.stringify({ symbol, amount, invested: invested === '' ? null : Number(invested) }) });
    $('#cold-symbol').value = '';
    $('#cold-amount').value = '';
    $('#cold-invested').value = '';
    renderColdList();
    state.portfolio = await api('/api/portfolio?force=1');
    renderDashboard();
    toast('Wallet fría actualizada');
  } catch (err) { toast(err.message, true); }
});

export function renderTelegram(tg) {
  const chip = $('#tg-status');
  if (chip) {
    chip.textContent = tg.configured ? 'conectado' : 'sin configurar';
    chip.className = 'chip' + (tg.configured ? ' chip-ok' : '');
  }
  const chat = $('#tg-chat');
  if (chat && tg.chatId && !chat.value) chat.value = tg.chatId;
  const token = $('#tg-token');
  if (token && !token.value) token.placeholder = tg.tokenMasked ? `${tg.tokenMasked} (guardado)` : '123456789:AAE...';
}
