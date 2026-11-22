'use strict';
// Doble factor (TOTP): activación con QR, confirmación, códigos de respaldo y desactivación.
import { $, api, esc, toast } from '../core.js';

// ---------------------------------------------------------------- doble factor
function totpShow(estado) {
  const off = $('#totp-off');
  const setup = $('#totp-setup');
  const on = $('#totp-on');
  if (!off || !setup || !on) return;
  off.classList.toggle('hidden', estado !== 'off');
  setup.classList.toggle('hidden', estado !== 'setup');
  on.classList.toggle('hidden', estado !== 'on');
  const chip = $('#totp-status');
  if (chip) {
    chip.textContent = estado === 'on' ? 'activo' : estado === 'setup' ? 'configurando' : 'desactivado';
    chip.classList.toggle('chip-ok', estado === 'on');
  }
}

export async function loadTotp() {
  try {
    const d = await api('/api/2fa/status');
    totpShow(d.enabled ? 'on' : 'off');
    if (d.enabled) {
      const info = $('#totp-codes');
      if (info) {
        info.classList.add('hidden');
        info.innerHTML = '';
      }
    }
  } catch {}
}

async function totpStart() {
  const res = $('#totp-result');
  try {
    const d = await api('/api/2fa/setup', { method: 'POST' });
    totpShow('setup');
    const img = $('#totp-qr-img');
    if (img) {
      if (d.qr) { img.src = d.qr; img.classList.remove('hidden'); }
      else { img.classList.add('hidden'); }
    }
    const sec = $('#totp-secret');
    if (sec) sec.textContent = d.secret.replace(/(.{4})/g, '$1 ').trim();
    if (res) res.innerHTML = d.qr ? '' : '<p class="hint">Sin generador de QR: escribe la clave a mano en tu app.</p>';
  } catch (e) {
    if (res) res.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

async function totpConfirm() {
  const code = ($('#totp-code') && $('#totp-code').value) || '';
  const res = $('#totp-result');
  try {
    const d = await api('/api/2fa/enable', { method: 'POST', body: { code } });
    totpShow('on');
    const box = $('#totp-codes');
    if (box && d.backupCodes) {
      box.classList.remove('hidden');
      box.innerHTML = `<h3 class="h3">Guarda estos códigos de respaldo</h3>
        <p class="hint">Cada uno sirve una sola vez, si pierdes el móvil. Guárdalos fuera de este ordenador.</p>
        <div class="totp-code-list">${d.backupCodes.map(c => `<code>${esc(c)}</code>`).join('')}</div>`;
    }
    toast('Doble factor activado', 'ok');
  } catch (e) {
    if (res) res.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

async function totpDisable() {
  const code = ($('#totp-off-code') && $('#totp-off-code').value) || '';
  try {
    await api('/api/2fa/disable', { method: 'POST', body: { code } });
    totpShow('off');
    toast('Doble factor desactivado', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

// Handlers del bloque de doble factor (antes estaban en el listener global).
document.addEventListener('click', e => {
  const tfa = e.target.closest ? e.target.closest('#totp-start,#totp-confirm,#totp-cancel,#totp-disable') : null;
  if (!tfa) return;
  if (tfa.id === 'totp-start') return void totpStart();
  if (tfa.id === 'totp-confirm') return void totpConfirm();
  if (tfa.id === 'totp-cancel') return void totpShow('off');
  if (tfa.id === 'totp-disable') return void totpDisable();
});
