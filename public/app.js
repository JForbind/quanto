'use strict';
/* ============================================================
   Quanto — interfaz
   ============================================================ */

import {
  $, $$, state, charts, eurFmt, eur0Fmt, groupNum, eur, eur0, num, pct, priceFmt, short,
  dateShort, dateLong, dateTime, relTime, esc, signed, arrow, api, setUnauthorized,
  toast,
} from './src/core.js';
import { renderPlansView, initPlans } from './src/views/plans.js';
import { renderAlertsView, initAlerts } from './src/views/alerts.js';
import { renderCoins, initCoins } from './src/views/coins.js';
import { themeVars, hexA, baseTooltip, chart } from './src/ui/charts.js';
import { openModal, closeModal } from './src/ui/modal.js';
import { RANGES, loadRanges, rangeFmt, initRanges } from './src/data/ranges.js';
import { PIE_COLORS, coinColor, loadCoinIcons, coinBadge, sparklineSvg } from './src/ui/coins.js';
import { loadNews, bindNews } from './src/views/news.js';

/* ------------------------------------------------ tema y gráficos */




/** Vacía un gráfico (mensaje de "sin datos") liberando antes la instancia. */
function clearChart(id, html) {
  if (typeof echarts === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;
  const inst = echarts.getInstanceByDom(el);
  if (inst) { inst.dispose(); charts.delete(id); }
  el.innerHTML = html || '';
}
function resizeCharts() { charts.forEach(c => { try { c.resize(); } catch {} }); }
window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(resizeCharts, 120); });



/* ------------------------------------------------ toast */
/* ------------------------------------------------ navegación */
/* canales de aviso (telegram / email) */
async function loadNotify() {
  try {
    const r = await api('/api/notify');
    const n = r.notify || {};
    const tg = $('#ch-telegram');
    if (tg) tg.checked = n.telegramEnabled !== false;
    const em = $('#ch-email');
    if (em) em.checked = !!n.emailEnabled;
    const addr = $('#notify-email');
    if (addr && n.email) addr.value = n.email;
    const note = $('#notify-sender');
    if (note) {
      note.textContent = r.mailReady
        ? 'El correo lo envía la cuenta configurada por el administrador.'
        : 'El administrador todavía no ha configurado el envío de correo.';
      const em2 = $('#ch-email');
      if (em2 && !r.mailReady) em2.disabled = true;
    }
  } catch {}
}

async function saveNotify() {
  const note = $('#notify-note');
  try {
    const r = await api('/api/notify', {
      method: 'POST',
      body: JSON.stringify({
        telegramEnabled: $('#ch-telegram')?.checked !== false,
        emailEnabled: !!$('#ch-email')?.checked,
        email: $('#notify-email')?.value.trim() || '',
      }),
    });
    if (note) note.textContent = 'Canales guardados.';
    return r;
  } catch (e) {
    if (note) note.textContent = e.message;
    throw e;
  }
}

$('#weekly-preview')?.addEventListener('click', () => {
  window.open('/api/weekly/preview', '_blank', 'noopener');
});

$('#notify-test')?.addEventListener('click', async () => {
  const note = $('#notify-note');
  try {
    await saveNotify();
    const r = await api('/api/notify/test', { method: 'POST', body: '{}' });
    if (note) note.textContent = 'Prueba enviada: ' + (r.sent || []).join(', ');
    toast('Prueba de canales enviada');
  } catch (e) {
    if (note) note.textContent = e.message;
  }
});

$('#ch-email')?.addEventListener('change', () => { if ($('#ch-email').checked) $('#notify-email')?.focus(); });
$('#notify-email')?.addEventListener('change', () => { saveNotify().catch(() => {}); });
$('#ch-telegram')?.addEventListener('change', () => { saveNotify().catch(() => {}); });

/* informe semanal */
$('#tg-weekly')?.addEventListener('change', async (e) => {
  try {
    await api('/api/weekly', { method: 'POST', body: JSON.stringify({ enabled: e.target.checked }) });
    toast(e.target.checked ? 'Informe semanal activado' : 'Informe semanal desactivado');
  } catch (err) { toast(err.message, true); }
});

$('#tg-weekly-now')?.addEventListener('click', async () => {
  try {
    await api('/api/weekly/send', { method: 'POST', body: '{}' });
    toast('Informe enviado a Telegram');
  } catch (err) { toast(err.message, true); }
});

const VIEW_TITLES = {
  news: ['Noticias', 'Titulares filtrados por tus monedas'],
  dashboard: ['Resumen', 'Tu cartera de un vistazo'],
  coins: ['Monedas', 'Posiciones, precio medio y rentabilidad'],
  market: ['Índices', 'Liquidez, deuda y sentimiento de mercado'],
  operations: ['Operaciones', 'Todas tus compras, ventas y movimientos'],
  tax: ['Fiscal', 'Informe FIFO listo para la declaración'],
  alerts: ['Alertas', 'Avisos de precio por Telegram'],
  trade: ['Trading', 'Velas, volumen y tendencia'],
  plans: ['Planes', 'Tu plan de compras, tramo a tramo'],
  sim: ['Simulador', 'Que pasa si el precio llega a...'],
  settings: ['Ajustes', 'Claves, historial, seguridad y datos'],
};

function navigate(view) {
  state.view = view;
  $$('.view').forEach(v => v.classList.add('hidden'));
  const target = $('#view-' + view);
  if (target) target.classList.remove('hidden');
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  renderSharedKpis(state.portfolio);
  const moreBtn = document.getElementById('more-btn');
  if (moreBtn) moreBtn.classList.toggle('is-active', ['operations', 'tax', 'plans', 'trade', 'sim', 'settings'].includes(view));
  const settingsBtn = $('#settings-btn');
  if (settingsBtn) settingsBtn.classList.toggle('is-active', view === 'settings');
  const [title, sub] = VIEW_TITLES[view] || ['Quanto', ''];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  if (view === 'settings') { loadTotp(); loadBackups(); loadCoherence(); }
  if (view === 'alerts') loadAutoAlerts();
  if (view === 'sim') {
    renderSim();
    if (!Object.keys(RANGES).length) {
      loadRanges().then(() => { if (state.view === 'sim') renderSim(); }).catch(() => {});
    }
  }
  if (view === 'news') loadNews();
  if (view === 'market') { loadLiquidity(); loadLeverage(); loadPulse(); loadCalendar(); }
  const topText = document.querySelector('.topbar-text');
  if (topText) {
    topText.classList.remove('is-entering');
    void topText.offsetWidth;
    topText.classList.add('is-entering');
  }
  if (view === 'dashboard') { renderDashboard(); watchRender(); loadSizing(); loadTwr(); }
  if (view === 'coins') renderCoins();
  if (view === 'tax') loadTax();
  if (view === 'operations') loadTransactions();
  if (view === 'settings') loadSettingsView();
  if (view === 'alerts') renderAlertsView();
  if (view === 'market') renderFearGreed();
  if (view === 'trade') loadTradeChart();
  if (view === 'plans') renderPlansView();
  setTimeout(resizeCharts, 60);
  if (location.hash !== '#/' + view) history.replaceState(null, '', '#/' + view);
}

/* Hoja "Más" del menú móvil */
function toggleMoreSheet(force) {
  const sheet = document.getElementById('more-sheet');
  const back = document.getElementById('more-backdrop');
  const btn = document.getElementById('more-btn');
  if (!sheet || !back) return;
  const open = force !== undefined ? force : sheet.classList.contains('hidden');
  sheet.classList.toggle('hidden', !open);
  back.classList.toggle('hidden', !open);
  if (btn) btn.classList.toggle('is-active', open);
}
document.getElementById('more-btn')?.addEventListener('click', () => toggleMoreSheet());
document.getElementById('more-backdrop')?.addEventListener('click', () => toggleMoreSheet(false));
document.querySelectorAll('.more-item').forEach(b => b.addEventListener('click', () => {
  toggleMoreSheet(false);
  navigate(b.dataset.view);
}));

$$('.nav-item').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.view) navigate(btn.dataset.view); }));
document.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.goto)));

/* ------------------------------------------------ login */
function showLogin() {
  document.body.classList.remove('is-app');
  pending2fa = null;
  const box2 = $('#login-2fa-box');
  if (box2) box2.classList.add('hidden');
  const b2 = $('#login-btn');
  if (b2) b2.textContent = 'Entrar';
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  setTimeout(() => { const i = $('#login-pass'); if (i) i.focus(); }, 80);
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  document.body.classList.add('is-app');
}

// ---------------------------------------------------------------- orden de pestañas
const NAV_SEL = '.sidebar .nav-item[data-view]';
const NAV_MORE_SEL = '.more-item[data-view]';
let navDragView = null;

function navItems(sel) {
  return Array.from(document.querySelectorAll(sel));
}

/** Pinta las asas de arrastre en cada pestaña del menú lateral. */
function navPrepareHandles() {
  navItems(NAV_SEL).forEach((item) => {
    if (item.querySelector('.nav-handle')) return;
    const asa = document.createElement('span');
    asa.className = 'nav-handle';
    asa.draggable = true;
    asa.title = 'Arrastra para cambiar el orden';
    asa.setAttribute('aria-hidden', 'true');
    asa.textContent = '⋮⋮';
    item.appendChild(asa);

    asa.addEventListener('dragstart', (e) => {
      navDragView = item.dataset.view;
      item.classList.add('nav-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', navDragView);
      } catch {}
    });
    asa.addEventListener('dragend', () => {
      item.classList.remove('nav-dragging');
      navDragView = null;
      navSaveOrder();
    });
    // arrastrar desde el asa no debe navegar
    asa.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  });

  navItems(NAV_SEL).forEach((item) => {
    if (item.dataset.dropReady) return;
    item.dataset.dropReady = '1';
    item.addEventListener('dragover', (e) => {
      if (!navDragView || item.dataset.view === navDragView) return;
      e.preventDefault();
      const arrastrado = document.querySelector(`${NAV_SEL.replace('[data-view]', '')}[data-view="${navDragView}"]`);
      if (!arrastrado) return;
      const r = item.getBoundingClientRect();
      const despues = e.clientY > r.top + r.height / 2;
      item.parentNode.insertBefore(arrastrado, despues ? item.nextSibling : item);
    });
    item.addEventListener('drop', (e) => {
      if (!navDragView) return;
      e.preventDefault();
    });
  });
}

/** Aplica el orden guardado (solo mueve las que existen). */
function navApplyOrder(order) {
  if (!Array.isArray(order) || !order.length) return;
  const lista = navItems(NAV_SEL);
  if (!lista.length) return;
  const contenedor = lista[0].parentNode;
  const porVista = new Map(lista.map(it => [it.dataset.view, it]));
  const enOrden = order.map(v => porVista.get(v)).filter(Boolean);
  // las que no estén en el orden guardado van al final, en su orden actual
  lista.forEach(it => { if (!enOrden.includes(it)) enOrden.push(it); });
  enOrden.forEach(it => contenedor.appendChild(it));

  // la hoja «Más» del móvil, con el mismo criterio
  const mas = Array.from(document.querySelectorAll(NAV_MORE_SEL));
  if (mas.length) {
    const cont = mas[0].parentNode;
    const mapa = new Map(mas.map(it => [it.dataset.view, it]));
    const ordenMas = order.map(v => mapa.get(v)).filter(Boolean);
    mas.forEach(it => { if (!ordenMas.includes(it)) ordenMas.push(it); });
    ordenMas.forEach(it => cont.appendChild(it));
  }

  // la barra inferior del móvil: las 4 primeras del orden del usuario
  const dock = document.querySelector('.mobile-nav');
  const btnMas = dock && dock.querySelector('#more-btn');
  if (dock && btnMas) {
    const ordenFinal = enOrden.map(it => it.dataset.view).filter(Boolean);
    const cuatro = ordenFinal.slice(0, 4);
    // guardar los botones actuales y vaciar la barra (dejando «Más»)
    const existentes = new Map();
    dock.querySelectorAll('[data-view]').forEach(b => { existentes.set(b.dataset.view, b); b.remove(); });
    cuatro.forEach(v => {
      let btn = existentes.get(v);
      if (!btn) {
        const src = porVista.get(v);
        if (!src) return;
        btn = src.cloneNode(true);
        btn.classList.remove('is-active');
        btn.draggable = false;
        btn.addEventListener('click', () => { if (btn.dataset.view) navigate(btn.dataset.view); });
      }
      dock.insertBefore(btn, btnMas);
    });
  }
}

async function navSaveOrder() {
  const order = navItems(NAV_SEL).map(it => it.dataset.view).filter(Boolean);
  if (!order.length) return;
  try {
    await api('/api/nav-order', { method: 'POST', body: { order } });
    toast('Orden del menú guardado', 'ok');
  } catch (e) {
    toast('No se pudo guardar el orden', 'err');
  }
}

// ---------------------------------------------------------------- doble factor
let pending2fa = null; // ticket temporal entre contraseña y código

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

async function loadTotp() {
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

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-error');
  err.textContent = '';
  btn.disabled = true;

  // Segundo paso: ya hay contraseña correcta, toca el código
  if (pending2fa) {
    btn.textContent = 'Comprobando…';
    try {
      const r2 = await fetch('/api/login/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: pending2fa, code: ($('#login-code') && $('#login-code').value) || '' }),
      });
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok) { err.textContent = d2.error || 'Código incorrecto'; return; }
      pending2fa = null;
      const box = $('#login-2fa-box');
      if (box) box.classList.add('hidden');
      $('#login-pass').value = '';
      resetSessionUi();
      state.me = d2.user || null;
      showApp();
      await boot();
      return;
    } catch (e3) {
      err.textContent = 'No se pudo conectar con el servidor';
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = pending2fa ? 'Verificar' : 'Entrar';
    }
  }

  btn.textContent = 'Entrando…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#login-user').value.trim(), password: $('#login-pass').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      err.textContent = data.error || 'Contraseña incorrecta';
      return;
    }
    if (data.need2fa) {
      pending2fa = data.ticket;
      const box = $('#login-2fa-box');
      if (box) box.classList.remove('hidden');
      btn.textContent = 'Verificar';
      err.textContent = '';
      const code = $('#login-code');
      if (code) { code.value = ''; code.focus(); }
      return;
    }
    pending2fa = null;
    $('#login-pass').value = '';
    resetSessionUi();
    state.me = data.user || null;
    showApp();
    await boot();
  } catch (e2) {
    err.textContent = 'No se pudo conectar con el servidor (' + ((e2 && e2.message) || 'error de red') + ')';
  } finally {
    btn.disabled = false;
    btn.textContent = pending2fa ? 'Verificar' : 'Entrar';
  }
});

async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  state.portfolio = null;
  resetSessionUi();
  showLogin();
}
$('#logout-btn').addEventListener('click', logout);
$('#logout-btn-2').addEventListener('click', logout);

/* ------------------------------------------------ tema */
function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem('quanto-theme', theme); } catch {}
  document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('is-active', b.dataset.theme === theme));
  setTimeout(() => { renderChartsForCurrentView(); }, 30);
  if (persist) {
    api('/api/settings', { method: 'POST', body: JSON.stringify({ theme }) }).catch(() => {});
  }
}
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next, true);
});
document.querySelectorAll('.theme-option').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme, true)));

/* ------------------------------------------------ modo privacidad */
const EYE_ON = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1"/><path d="M6.3 6.5A17 17 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4.2-.9"/>';

function applyPrivacy(on, persist = true) {
  if (on) document.documentElement.dataset.privacy = '1';
  else delete document.documentElement.dataset.privacy;
  const btn = $('#privacy-btn');
  if (btn) {
    btn.classList.toggle('is-on', on);
    const svg = btn.querySelector('svg');
    if (svg) svg.innerHTML = on ? EYE_OFF : EYE_ON;
    const span = btn.querySelector('span');
    if (span) span.textContent = on ? 'Privacidad ON' : 'Privacidad';
    btn.title = on ? 'Mostrar importes' : 'Ocultar importes';
  }
  if (persist) { try { localStorage.setItem('quanto-privacy', on ? '1' : '0'); } catch {} }
}

$('#privacy-btn')?.addEventListener('click', () => {
  applyPrivacy(document.documentElement.dataset.privacy !== '1');
});

/* ============================================================
   CARGA DE DATOS
   ============================================================ */
/* Tragaperras de los KPIs: solo en la primera apertura de la app */
let kpiRolled = false;
function euroToNumber(text) {
  const clean = String(text == null ? '' : text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(clean);
  return isFinite(n) ? n : NaN;
}
function rollKpiNumbers() {
  if (kpiRolled) return;
  kpiRolled = true;
  const nodes = [...document.querySelectorAll('.kpi-value')].filter(el => el.offsetParent !== null);
  nodes.forEach((el, i) => {
    const raw = el.textContent.trim();
    const target = euroToNumber(raw);
    if (!isFinite(target) || target === 0) return;
    const plus = raw.startsWith('+');
    const startAt = performance.now() + i * 70;
    const dur = 950;
    const ease = t => 1 - Math.pow(1 - t, 3);
    const frame = (now) => {
      if (now < startAt) return requestAnimationFrame(frame);
      const t = Math.min(1, (now - startAt) / dur);
      el.textContent = (plus && target >= 0 ? '+' : '') + eur(target * ease(t));
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = raw;
    };
    requestAnimationFrame(frame);
  });
}

/* Los iconos que fallan se quitan y queda la insignia con iniciales.
   (El CSP bloquea los onerror inline, así que se hace desde JS.) */
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.classList && el.classList.contains('coin-badge-dyn')) el.remove();
}, true);
document.addEventListener('load', (e) => {
  const el = e.target;
  if (el && el.classList && el.classList.contains('coin-badge-dyn')) el.classList.add('is-loaded');
}, true);

/* ------------------------------------------------ usuarios y sesión */
/* Limpia la interfaz al cambiar de sesión (evita restos del panel admin) */
function resetSessionUi() {
  state.me = null;
  document.body.classList.remove('is-admin');
  $$('.sidebar .nav-item').forEach(b => b.classList.remove('hidden'));
  $$('#view-settings .card').forEach(c => c.classList.remove('hidden'));
  const users = $('#users-card'); if (users) users.classList.add('hidden');
  const mail = $('#mail-card'); if (mail) mail.classList.add('hidden');
  if (location.hash && location.hash !== '#/') history.replaceState(null, '', location.pathname);
}

async function loadMe() {
  try {
    const r = await api('/api/me');
    state.me = r.user || null;
  } catch { state.me = null; }
}

function applyAdminUi() {
  document.body.classList.add('is-admin');
  $$('.sidebar .nav-item').forEach(b => b.classList.add('hidden'));
  const card = $('#users-card');
  if (card) card.classList.remove('hidden');
  const mailCard = $('#mail-card');
  if (mailCard) mailCard.classList.remove('hidden');
  loadMail();
  $('#view-settings')?.querySelectorAll('.card').forEach(c => {
    if (c.id === 'users-card' || c.id === 'mail-card' || c.id === 'password-card') return;
    c.classList.add('hidden');
  });
  navigate('settings');
  loadUsers();
}

async function loadMail() {
  try {
    const r = await api('/api/mail');
    const m = r.mail || {};
    $('#mail-host').value = m.host || '';
    $('#mail-port').value = m.port || 465;
    $('#mail-secure').value = m.secure ? '1' : '0';
    $('#mail-user').value = m.user || '';
    $('#mail-from').value = m.from || '';
    $('#mail-pass').value = m.hasPass ? '__KEEP__' : '';
    $('#mail-status').textContent = m.ready
      ? (m.source === 'env' ? 'Configurado por variables de entorno.' : 'Configurado y listo.')
      : 'Sin configurar: las invitaciones se copian a mano.';
  } catch (e) { $('#mail-status').textContent = e.message; }
}

$('#mail-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#mail-status');
  try {
    const r = await api('/api/mail', { method: 'POST', body: JSON.stringify({
      host: $('#mail-host').value.trim(),
      port: Number($('#mail-port').value) || 465,
      secure: $('#mail-secure').value === '1',
      user: $('#mail-user').value.trim(),
      pass: $('#mail-pass').value,
      from: $('#mail-from').value.trim(),
    }) });
    out.textContent = r.mail && r.mail.ready ? 'Guardado. Ya se pueden enviar correos.' : 'Guardado (falta la contraseña).';
  } catch (err) { out.textContent = err.message; }
});

$('#mail-test')?.addEventListener('click', async () => {
  const out = $('#mail-status');
  out.textContent = 'Enviando prueba…';
  try {
    const to = prompt('¿A qué email te mando la prueba?', $('#mail-user').value || '');
    if (!to) { out.textContent = 'Cancelado'; return; }
    const r = await api('/api/mail/test', { method: 'POST', body: JSON.stringify({ to }) });
    out.textContent = 'Prueba enviada a ' + r.to + '. Revisa la bandeja (y el spam).';
  } catch (err) { out.textContent = 'Error: ' + err.message; }
});

async function loadUsers() {
  const box = $('#users-list');
  if (!box) return;
  try {
    const r = await api('/api/users');
    box.innerHTML = (r.users || []).map(u => {
      const seen = u.lastSeenAt ? new Date(u.lastSeenAt) : null;
      const online = seen && (Date.now() - seen.getTime()) < 10 * 60e3;
      const lastTxt = u.lastLoginAt
        ? new Date(u.lastLoginAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'nunca';
      return `
      <div class="user-row">
        <b>${esc(u.username)}</b>
        <span class="chip ${u.role === 'admin' ? 'chip-warn' : ''}">${u.role === 'admin' ? 'admin' : 'usuario'}</span>
        <span class="chip ${online ? 'chip-ok' : ''}">${online ? 'en línea' : (u.active ? 'activo' : 'desactivado')}</span>
        <span class="muted tiny user-last" title="Última conexión">Última: ${esc(lastTxt)}${u.loginCount ? ' · ' + u.loginCount + (u.loginCount === 1 ? ' acceso' : ' accesos') : ''}${u.resetRequestedAt ? ' · pidió reset' : ''}</span>
        ${u.totp ? `<button class="btn btn-ghost btn-xs" data-user-2fa="${esc(u.id)}" title="Quitar el doble factor a este usuario">2FA off</button>` : ''}
        <button class="btn btn-ghost btn-xs" data-user-reset="${esc(u.id)}">Resetear</button>
        <button class="btn btn-ghost btn-xs" data-user-toggle="${esc(u.id)}">${u.active ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-ghost btn-xs btn-danger-ghost" data-user-del="${esc(u.id)}">Borrar</button>
      </div>`; }).join('') || '<p class="muted tiny">Sin usuarios.</p>';
  } catch (e) {
    box.innerHTML = `<p class="muted tiny">${esc(e.message)}</p>`;
  }
}

/* ------------------------------------------------ liquidez y noticias */
const LIQ_STATE = {
  exp: { label: 'Expansión', cls: 'chip-ok' },
  neutro: { label: 'Neutro', cls: '' },
  cont: { label: 'Contracción', cls: 'chip-warn' },
};

function moneyB(v) {
  if (!isFinite(v)) return '—';
  const m = v / 1e6; // millones de dólares, sin ambigüedad
  return num(m, 0) + ' M$';
}

async function loadLiquidity() {
  try {
    const d = await api('/api/liquidity');
    const st = LIQ_STATE[d.state && d.state.key] || LIQ_STATE.neutro;
    const chip = $('#liq-state');
    if (chip) { chip.textContent = st.label; chip.className = 'chip ' + st.cls; }
    const total = $('#liq-total'); if (total) total.textContent = moneyB(d.total);
    const c24 = $('#liq-24');
    if (c24) {
      const up = d.change24 >= 0;
      c24.textContent = (up ? '+' : '') + num(d.change24, 2) + ' % 24 h';
      c24.className = 'tiny ' + signed(d.change24);
    }
    const c30 = $('#liq-30');
    if (c30) {
      c30.textContent = (d.change30 >= 0 ? '+' : '') + num(d.change30, 2) + ' %';
      c30.className = signed(d.change30);
    }
    const dom = $('#liq-dom');
    if (dom) dom.textContent = d.dominance != null ? num(d.dominance, 2) + ' %' : '—';
    const note = $('#liq-note');
    if (note) note.textContent = d.state && d.state.key === 'cont'
      ? 'Las stablecoins se reducen: hay menos liquidez entrando al mercado.'
      : d.state && d.state.key === 'exp'
        ? 'Entra dinero nuevo: las stablecoins crecen.'
        : 'Saldo estable: sin cambio claro de liquidez.';
    const v = themeVars();
    const series = (d.series || []).map(p => [p[0], p[1]]);
    if (series.length) {
      chart('chart-liq', {
        grid: { left: 0, right: 0, top: 6, bottom: 0 },
        xAxis: { type: 'time', show: false },
        yAxis: { type: 'value', show: false, scale: true },
        tooltip: { ...baseTooltip(v), formatter: (items) => {
          const it = items[0];
          return new Date(it.value[0]).toLocaleDateString('es-ES') + '<br/>' + moneyB(it.value[1]);
        } },
        series: [{
          type: 'line', data: series, showSymbol: false, smooth: true,
          lineStyle: { width: 2, color: d.state && d.state.key === 'cont' ? v.neg : v.pos },
          areaStyle: { opacity: .12, color: d.state && d.state.key === 'cont' ? v.neg : v.pos },
        }],
      });
    }
  } catch (e) {
    const note = $('#liq-note');
    if (note) note.textContent = 'Sin datos de liquidez: ' + e.message;
  }
}

let PULSE = null;

async function loadCalendar() {
  const box = $('#cal-list');
  if (!box) return;
  try {
    const d = await api('/api/calendar');
    const chip = $('#cal-chip');
    if (!d.configured) {
      if (chip) { chip.textContent = 'Sin clave'; chip.className = 'chip'; }
      box.innerHTML = '<p class="muted tiny">Añade tu clave de FRED en <b>Ajustes → Datos macro</b>.</p>';
      return;
    }
    const items = d.items || [];
    if (chip) { chip.textContent = items.length ? items.length + ' eventos' : 'Sin datos'; chip.className = 'chip'; }
    if (!items.length) { box.innerHTML = '<p class="muted tiny">Sin publicaciones en los próximos 60 días.</p>'; return; }
    const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    box.innerHTML = items.map(it => {
      const near = it.days <= 3;
      const label = it.days === 0 ? 'hoy' : it.days === 1 ? 'mañana' : 'en ' + it.days + ' días';
      return `<div class="cal-row${near ? ' is-near' : ''}">
        <span class="cal-date">${esc(fmt(it.date))}</span>
        <span class="cal-name">${esc(it.name)}</span>
        <span class="cal-days">${esc(label)}</span>
      </div>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<p class="muted tiny">${esc(e.message)}</p>`;
  }
}

$('#fred-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = $('#fred-note');
  try {
    const key = $('#fred-key').value.trim();
    const r = await api('/api/calendar/key', { method: 'POST', body: JSON.stringify({ key }) });
    note.textContent = r.configured ? 'Clave guardada. El calendario ya funciona.' : 'Clave borrada.';
    $('#fred-key').value = '';
    loadCalendar();
  } catch (err) { note.textContent = err.message; }
});

async function loadPulse() {
  try {
    const d = await api('/api/pulse');
    PULSE = d;
    const b = d.breadth || {};
    const el = $('#pulse-breadth');
    if (el) el.textContent = `${b.up} de ${b.total}`;
    const sub = $('#pulse-breadth-sub');
    if (sub) sub.textContent = num(b.pctUp, 0) + ' % en verde';
    const fill = $('#breadth-fill');
    if (fill) fill.style.width = Math.max(2, Math.min(100, b.pctUp || 0)) + ' %';
    const f = d.funding || {};
    const fe = $('#pulse-funding');
    if (fe) {
      fe.textContent = (f.avg >= 0 ? '+' : '') + num(f.avg, 3) + ' %';
      fe.className = signed(f.avg);
    }
    const fs = $('#pulse-funding-sub');
    if (fs) fs.textContent = 'cada 8 h · mediana ' + num(f.median, 3) + ' %';
    const pos = $('#pulse-pos');
    if (pos) pos.textContent = `${f.positive || 0} de ${f.count || 0}`;
    const chip = $('#pulse-chip');
    if (chip) {
      const pct = b.pctUp || 0;
      const label = pct < 30 ? 'Débil' : pct > 70 ? 'Fuerte' : 'Mixto';
      chip.textContent = label;
      chip.className = 'chip ' + (pct < 30 ? 'chip-warn' : pct > 70 ? 'chip-ok' : '');
    }
    // funding de tus monedas
    const row = $('#pulse-coins');
    if (row) {
      const mine = ((state.portfolio && state.portfolio.coins) || []).map(c => c.symbol).slice(0, 6);
      row.innerHTML = mine.map(sym => {
        const r = f.map ? f.map[sym] : null;
        if (r == null) return '';
        return `<span class="chip ${r >= 0 ? 'chip-ok' : 'chip-warn'}">${esc(sym)} ${r >= 0 ? '+' : ''}${num(r, 3)} %</span>`;
      }).join('') || '<span class="muted tiny">Sin funding para tus monedas (no cotizan en perpetuos).</span>';
    }
    const note = $('#pulse-note');
    if (note) {
      note.textContent = (f.avg || 0) < 0
        ? 'Funding negativo: los cortos pagan a los largos; el mercado está sobrevendido.'
        : 'Funding positivo: los largos pagan; hay más apalancamiento comprador.';
    }
  } catch (e) {
    const note = $('#pulse-note');
    if (note) note.textContent = 'Sin datos: ' + e.message;
  }
}

async function loadLeverage() {
  try {
    const d = await api('/api/leverage');
    const risk = $('#debt-risk');
    if (risk) {
      const map = { alto: 'Riesgo alto', medio: 'Riesgo medio', bajo: 'Riesgo bajo' };
      const cls = { alto: 'chip-warn', medio: '', bajo: 'chip-ok' };
      risk.textContent = map[d.risk && d.risk.key] || '—';
      risk.className = 'chip ' + (cls[d.risk && d.risk.key] || '');
    }
    const dt = $('#debt-total'); if (dt) dt.textContent = moneyB(d.debt);
    const dc = $('#debt-chg');
    if (dc) { dc.textContent = (d.debtChange30 >= 0 ? '+' : '') + num(d.debtChange30, 2) + ' %'; dc.className = 'tiny ' + signed(d.debtChange30); }
    const ot = $('#oi-total'); if (ot) ot.textContent = moneyB(d.oi);
    const oc = $('#oi-chg');
    if (oc) { oc.textContent = (d.oiChange30 >= 0 ? '+' : '') + num(d.oiChange30, 2) + ' %'; oc.className = 'tiny ' + signed(d.oiChange30); }
    const lr = $('#lev-ratio'); if (lr) lr.textContent = d.leverage != null ? num(d.leverage, 2) + ' %' : '—';
    const note = $('#debt-note');
    if (note) {
      const alto = d.risk && d.risk.key === 'alto';
      note.textContent = alto
        ? 'Suben la deuda y el apalancamiento: más riesgo de liquidaciones en cascada.'
        : 'Deuda y apalancamiento a la baja: menos presión sobre el precio.';
    }
    const v = themeVars();
    const series = d.series || [];
    if (series.length) {
      chart('chart-debt', {
        grid: { left: 0, right: 0, top: 6, bottom: 0 },
        legend: { show: false },
        xAxis: { type: 'category', show: false, data: series.map(p => p.d) },
        yAxis: { type: 'value', show: false, scale: true },
        tooltip: { ...baseTooltip(v), formatter: (its) => {
          const d0 = its[0];
          const row = series[d0.dataIndex];
          if (!row) return '';
          return new Date(row.d).toLocaleDateString('es-ES') +
            '<br/>Deuda: ' + (row.debt ? moneyB(row.debt) : '—') +
            '<br/>OI: ' + (row.oi ? moneyB(row.oi) : '—');
        } },
        series: [
          { name: 'Deuda', type: 'line', data: series.map(p => p.debt), showSymbol: false, smooth: true, lineStyle: { width: 2, color: v.accent } },
          { name: 'OI', type: 'line', data: series.map(p => p.oi), showSymbol: false, smooth: true, lineStyle: { width: 2, color: (d.risk && d.risk.key === 'alto') ? v.neg : v.muted, type: [4, 3] } },
        ],
      });
    }
  } catch (e) {
    const note = $('#debt-note');
    if (note) note.textContent = 'Sin datos de deuda: ' + e.message;
  }
}

// Noticias vive en su propio módulo (src/views/news.js).
function showSetup(needed) {
  $('#login').classList.add('hidden');
  $('#app').classList.add('hidden');
  const box = $('#setup');
  if (box) box.classList.remove('hidden');
  const note = $('#setup-data');
  if (note) { note.checked = !!needed.legacy; note.disabled = !!needed.legacy; }
  const u = $('#setup-user'); if (u) u.focus();
}

$('#setup-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#setup-error');
  err.textContent = '';
  if ($('#setup-pass').value !== $('#setup-pass2').value) { err.textContent = 'Las contraseñas no coinciden'; return; }
  try {
    const r = await fetch('/api/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('#setup-user').value.trim(),
        email: $('#setup-email').value.trim(),
        password: $('#setup-pass').value,
        canData: $('#setup-data').checked,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.problems ? 'Falta: ' + d.problems.join(', ') : (d.error || 'No se pudo crear'); return; }
    state.me = d.user || null;
    history.replaceState(null, '', '/');
    showApp();
    await boot();
  } catch { err.textContent = 'No se pudo conectar'; }
});

async function showInvite(token) {
  $('#login').classList.add('hidden');
  $('#app').classList.add('hidden');
  const box = $('#invite');
  if (!box) return;
  box.classList.remove('hidden');
  const userEl = $('#invite-user');
  try {
    const r = await fetch('/api/invite/' + encodeURIComponent(token));
    const d = await r.json();
    if (!r.ok) { userEl.textContent = d.error || 'Enlace no válido'; $('#invite-btn').disabled = true; return; }
    userEl.textContent = 'Cuenta: ' + d.username;
    $('#invite-form').dataset.token = token;
  } catch {
    userEl.textContent = 'No se pudo comprobar el enlace';
  }
}

// ---------------------------------------------------------------- eventos del simulador
document.addEventListener('change', e => {
  const t = e.target;
  if (!t) return;
  if (t.id === 'sim-coin') { simState.symbol = t.value; simState.price = Number(simCoinObject(t.value).price) || 0; simState.tax = null; renderSim(); }
  if (t.id === 'sim-price') { simState.price = Number(t.value) || 0; simState.tax = null; renderSim(); }
  if (t.id === 'sim-buy-eur') { simState.buyAmount = Number(t.value) || 0; renderSim(); }
});
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'sim-buy-eur') {
    simState.buyAmount = Number(e.target.value) || 0;
    const p = simNumbers();
    const q = $('#sim-buy-qty');
    if (q && p && p.coin.price > 0) q.value = num(simState.buyAmount / p.coin.price, 8) + ' ' + simState.symbol;
    clearTimeout(window.__simBuyT);
    window.__simBuyT = setTimeout(() => renderSimBuy(p && p.coin.price > 0 ? simState.buyAmount / p.coin.price : 0), 350);
  }
});
// alertas automáticas: botones de encendido y porcentajes
document.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('#auto-drop-btn,#auto-rise-btn') : null;
  if (!b) return;
  e.preventDefault();
  const dir = b.id === 'auto-drop-btn' ? 'drop' : 'rise';
  AUTO[dir].on = !AUTO[dir].on;
  autoPintar();
  saveAutoAlerts();
}, true);
document.addEventListener('change', e => {
  const t2 = e.target;
  if (!t2) return;
  if (t2.id === 'auto-drop-pct') { AUTO.drop.pct = Number(t2.value) || 6; saveAutoAlerts(); }
  if (t2.id === 'auto-rise-pct') { AUTO.rise.pct = Number(t2.value) || 5; saveAutoAlerts(); }
  if (t2.id === 'auto-window') { AUTO.windowMin = Number(t2.value) || 60; saveAutoAlerts(); }
});

// buscador de monedas
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'coin-search') {
    clearTimeout(window.__csT);
    window.__csT = setTimeout(() => buscadorMonedas(e.target.value), 180);
  }
});
document.addEventListener('focusin', e => {
  if (e.target && e.target.id === 'coin-search' && e.target.value) buscadorMonedas(e.target.value);
});
document.addEventListener('click', (e) => {
  const add = e.target.closest ? e.target.closest('[data-watch-add]') : null;
  if (add) {
    e.preventDefault();
    const sym = add.dataset.watchAdd;
    if (WATCH.includes(sym)) { watchToggle(sym, false); }
    else { watchToggle(sym, true); }
    const inp = $('#coin-search');
    if (inp) inp.value = '';
    const box = $('#coin-search-results');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
    return;
  }
  const off = e.target.closest ? e.target.closest('[data-watch-off]') : null;
  if (off) { e.preventDefault(); watchToggle(off.dataset.watchOff, false); return; }
  // clic fuera: cerrar resultados
  const box = $('#coin-search-results');
  const inp = $('#coin-search');
  if (box && inp && !box.contains(e.target) && e.target !== inp) box.classList.add('hidden');
}, true);

// las estrellas se atienden antes que el clic de la fila (fase de captura)
document.addEventListener('click', e => {
}, true);

document.addEventListener('click', e => {
  const tfa = e.target.closest ? e.target.closest('#totp-start,#totp-confirm,#totp-cancel,#totp-disable') : null;
  if (tfa) {
    if (tfa.id === 'totp-start') { totpStart(); return; }
    if (tfa.id === 'totp-confirm') { totpConfirm(); return; }
    if (tfa.id === 'totp-cancel') { totpShow('off'); return; }
    if (tfa.id === 'totp-disable') { totpDisable(); return; }
  }
  const btn = e.target.closest ? e.target.closest('[data-sim-price],[data-sim-del],#sim-save') : null;
  if (!btn) return;
  if (btn.id === 'sim-save') {
    const list = simSaved();
    list.push({ symbol: simState.symbol, price: Number(simState.price) });
    simSave(list.slice(-8));
    renderSimSaved();
    return;
  }
  if (btn.dataset.simPrice) {
    simState.price = Number(btn.dataset.simPrice);
    simState.tax = null;
    renderSim();
    return;
  }
  if (btn.dataset.simDel !== undefined) {
    const list = simSaved();
    list.splice(Number(btn.dataset.simDel), 1);
    simSave(list);
    renderSimSaved();
  }
});

// ---------------------------------------------------------------- alertas automáticas
let AUTO = { drop: { on: false, pct: 6 }, rise: { on: false, pct: 5 }, windowMin: 60 };

function autoPintar() {
  const dBtn = $('#auto-drop-btn');
  const rBtn = $('#auto-rise-btn');
  if (dBtn) { dBtn.classList.toggle('is-active', !!AUTO.drop.on); dBtn.setAttribute('aria-pressed', AUTO.drop.on ? 'true' : 'false'); }
  if (rBtn) { rBtn.classList.toggle('is-active', !!AUTO.rise.on); rBtn.setAttribute('aria-pressed', AUTO.rise.on ? 'true' : 'false'); }
  const chip = $('#auto-status');
  if (chip) {
    const ventana = AUTO.windowMin < 60 ? AUTO.windowMin + ' min' : (AUTO.windowMin / 60) + ' h';
    const activas = [];
    if (AUTO.drop.on) activas.push('bajada ' + AUTO.drop.pct + ' %');
    if (AUTO.rise.on) activas.push('subida ' + AUTO.rise.pct + ' %');
    chip.textContent = activas.length ? activas.join(' · ') + ' · ' + ventana : 'desactivadas';
    chip.classList.toggle('chip-ok', activas.length > 0);
  }
}

async function loadAutoAlerts() {
  try {
    const d = await api('/api/auto-alerts');
    AUTO = { drop: { on: !!d.drop.on, pct: Number(d.drop.pct) || 6 }, rise: { on: !!d.rise.on, pct: Number(d.rise.pct) || 5 }, windowMin: Number(d.windowMin) || 60 };
    const dPct = $('#auto-drop-pct'), rPct = $('#auto-rise-pct'), win = $('#auto-window');
    if (dPct) dPct.value = AUTO.drop.pct;
    if (rPct) rPct.value = AUTO.rise.pct;
    if (win) win.value = String(AUTO.windowMin);
    autoPintar();
  } catch {}
}

async function saveAutoAlerts() {
  try {
    const d = await api('/api/auto-alerts', { method: 'POST', body: AUTO });
    AUTO = { drop: { on: !!d.drop.on, pct: Number(d.drop.pct) || 6 }, rise: { on: !!d.rise.on, pct: Number(d.rise.pct) || 5 }, windowMin: Number(d.windowMin) || 60 };
    autoPintar();
    toast('Alertas automáticas guardadas', 'ok');
  } catch (e) {
    toast('No se pudieron guardar: ' + e.message, 'err');
  }
}

// ---------------------------------------------------------------- lista de vigilancia
let WATCH = [];
let MERCADOS = [];

function watchRender() {
  const box = $('#watch-list');
  if (!box) return;
  const sub = $('#watch-sub');
  const coins = ((state.portfolio && state.portfolio.coins) || []);
  if (sub) sub.textContent = WATCH.length ? `${WATCH.length} monedas en vigilancia` : 'Las monedas que sigues, con o sin posición';
  if (!WATCH.length) {
    box.innerHTML = '<p class="muted tiny">Busca una moneda en la barra de arriba y pulsa para añadirla aquí.</p>';
    return;
  }
  box.innerHTML = WATCH.map(sym => {
    const enCartera = coins.find(c => c.symbol === sym);
    const m = MERCADOS.find(x => x.symbol === sym) || {};
    const precio = enCartera ? enCartera.price : m.price;
    const cambio = enCartera ? enCartera.dayChangePct : m.change;
    return `<div class="watch-item" data-symbol="${esc(sym)}">
      <span class="watch-top">
        <span class="coin">${coinBadge(sym)}<span class="watch-name">${esc(sym)}</span>${enCartera ? '<span class="watch-tag">cartera</span>' : ''}</span>
        <button class="watch-del" data-watch-off="${esc(sym)}" title="Quitar de vigilancia">×</button>
      </span>
      <span class="watch-bottom">
        <span class="watch-price">${precio ? priceFmt(precio) : '—'}</span>
        <span class="watch-chg ${signed(cambio || 0)}">${cambio === null || cambio === undefined ? '—' : pct(cambio)}</span>
      </span>
      ${WSPARK[sym] && WSPARK[sym].length > 2 ? `<span class="watch-spark">${sparklineWide(WSPARK[sym])}</span>` : ''}
    </div>`;
  }).join('');
}

let WSPARK = {};

async function loadWatch() {
  try {
    const d = await api('/api/watchlist');
    WATCH = d.watchlist || [];
    watchRender();
    loadWatchSpark();
  } catch {}
}

async function loadWatchSpark() {
  if (!WATCH.length) { WSPARK = {}; return; }
  try {
    const d = await api('/api/sparklines?extra=' + encodeURIComponent(WATCH.join(',')));
    WSPARK = d.sparklines || {};
    watchRender();
  } catch {}
}

async function loadMercados(force) {
  if (!force && MERCADOS.length) return MERCADOS;
  try {
    const d = await api('/api/markets');
    MERCADOS = d.markets || [];
  } catch {}
  return MERCADOS;
}

async function watchToggle(symbol, on) {
  try {
    const d = await api('/api/watchlist', { method: 'POST', body: { symbol, on } });
    WATCH = d.watchlist || [];
    watchRender();
    loadRanges();
    if (state.view === 'sim') renderSim();
    const sel = $('#trade-symbol');
    if (sel) sel.dataset.ready = '';
  } catch (e) { toast('No se pudo guardar', 'err'); }
}

// buscador de la barra superior
async function buscadorMonedas(texto) {
  const box = $('#coin-search-results');
  if (!box) return;
  const q = String(texto || '').trim().toUpperCase();
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  await loadMercados();
  const hits = MERCADOS.filter(m => m.symbol.includes(q)).slice(0, 8);
  if (!hits.length) {
    box.innerHTML = '<p class="muted tiny" style="padding:8px 10px;margin:0">Sin resultados en Bitvavo</p>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = hits.map(m => {
    const dentro = WATCH.includes(m.symbol);
    const cartera = ((state.portfolio && state.portfolio.coins) || []).some(c => c.symbol === m.symbol);
    return `<button class="cs-row" data-watch-add="${esc(m.symbol)}">
      <span class="cs-sym">${esc(m.symbol)}</span>
      <span class="cs-price">${priceFmt(m.price)}</span>
      <span class="cs-chg ${signed(m.change || 0)}">${m.change === null || m.change === undefined ? '—' : pct(m.change)}</span>
      <span class="cs-add">${dentro ? '✓ en vigilancia' : cartera ? 'en cartera' : '+ vigilar'}</span>
    </button>`;
  }).join('');
  box.classList.remove('hidden');
}

// ---------------------------------------------------------------- simulador
const SIM_KEY = 'quanto.sim.escenarios';
const simState = { symbol: null, price: null, buyAmount: 150, tax: null, taxAt: 0 };

function simSaved() {
  try { return JSON.parse(localStorage.getItem(SIM_KEY) || '[]'); } catch { return []; }
}
function simSave(list) { try { localStorage.setItem(SIM_KEY, JSON.stringify(list)); } catch {} }

function simDefaults() {
  const p = state.portfolio;
  const cartera = ((p && p.coins) || []).filter(c => c.amount > 0);
  const seguidas = (typeof WATCH !== 'undefined' && Array.isArray(WATCH)) ? WATCH : [];
  const lista = [...new Set([...cartera.map(c => c.symbol), ...seguidas])];
  if (!lista.length) return;
  if (!simState.symbol || !lista.includes(simState.symbol)) {
    simState.symbol = lista[0];
    const c = simCoinObject(lista[0]);
    simState.price = Number(c.price) || 0;
  }
}

function simCoinObject(symbol) {
  const p = state.portfolio;
  const enCartera = ((p && p.coins) || []).find(c => c.symbol === symbol);
  if (enCartera) return enCartera;
  // moneda en seguimiento: sin posición, con el precio de mercado
  const m = (typeof MERCADOS !== 'undefined' ? MERCADOS : []).find(x => x.symbol === symbol) || {};
  return {
    symbol,
    amount: 0,
    price: Number(m.price) || 0,
    dayChangePct: m.change === undefined ? null : m.change,
    avgPrice: 0,
    value: 0,
    invested: 0,
    costKnown: false,
    onExchange: 0,
    inCold: 0,
    enCartera: false,
  };
}

function simNumbers() {
  const p = state.portfolio;
  const coin = simCoinObject(simState.symbol);
  if (!p || !coin) return null;
  const price = Number(simState.price) || 0;
  const cash = Number(p.cash) || 0;
  const cryptoValue = Number(p.totalValue) - cash;
  const newCoinValue = coin.amount * price;
  const newCrypto = cryptoValue - coin.value + newCoinValue;
  const newTotal = newCrypto + cash;
  const delta = newTotal - p.totalValue;
  const newPnl = newCrypto - p.invested;
  const weight = newTotal > 0 ? (newCoinValue / newTotal) * 100 : 0;
  const vsAvg = coin.avgPrice > 0 ? ((price - coin.avgPrice) / coin.avgPrice) * 100 : null;
  return { p, coin, price, cash, cryptoValue, newCoinValue, newCrypto, newTotal, delta, newPnl, weight, vsAvg };
}

function renderSim() {
  simDefaults();
  const p = state.portfolio;
  const box = $('#sim-coin');
  if (!box || !p) return;

  const cartera = (p.coins || []).filter(c => c.amount > 0).map(c => c.symbol);
  const seguidas = (typeof WATCH !== 'undefined' && Array.isArray(WATCH)) ? WATCH : [];
  const lista = [...new Set([...cartera, ...seguidas])].sort();
  box.innerHTML = lista.map(s => {
    const marca = cartera.includes(s) ? '' : ' · seguimiento';
    return `<option value="${esc(s)}"${s === simState.symbol ? ' selected' : ''}>${esc(s)}${marca}</option>`;
  }).join('');
  const priceInput = $('#sim-price');
  if (priceInput && document.activeElement !== priceInput) priceInput.value = simState.price;

  const n = simNumbers();
  if (!n) return;

  const r = RANGES[simState.symbol] || {};
  const base = Number(n.coin.price) || 0;
  // Siempre los mismos nueve botones: los que no aplican salen deshabilitados,
  // así la rejilla no cambia de forma entre monedas en cartera y en seguimiento.
  const tienePosicion = Number(n.coin.amount) > 0;
  const presets = [
    ['Precio actual', base, 'El precio de ahora mismo'],
    ['−50 %', base * 0.5, 'La mitad del precio actual'],
    ['−25 %', base * 0.75, 'Un 25 % por debajo'],
    ['+25 %', base * 1.25, 'Un 25 % por encima'],
    ['+50 %', base * 1.5, 'Un 50 % por encima'],
    ['×2', base * 2, 'El doble del precio actual'],
    ['Tu precio medio', n.coin.avgPrice, tienePosicion ? 'Tu precio medio de compra' : 'Sin posición: no hay precio medio'],
    ['Máximo del año', r.high, 'Precio más alto de este año'],
    ['Máx. histórico', r.ath, 'Precio más alto de la historia'],
  ];
  $('#sim-presets').innerHTML = presets.map(([label, value, title]) => {
    const ok = Number(value) > 0;
    if (!ok) {
      return `<button class="btn btn-ghost btn-xs" type="button" disabled title="${esc(title)}">${label}</button>`;
    }
    const activo = Math.abs(value - n.price) <= Math.abs(value) * 0.0005;
    return `<button class="btn btn-ghost btn-xs${activo ? ' is-active' : ''}" type="button" data-sim-price="${value.toFixed(6)}" title="${esc(title)}">${label}</button>`;
  }).join('');

  $('#sim-now').innerHTML = n.coin.amount > 0
    ? `Precio ahora de ${esc(simState.symbol)}: <b>${priceFmt(n.coin.price)}</b> · tu media: <b>${n.coin.costKnown ? priceFmt(n.coin.avgPrice) : 'n/d'}</b> · ${num(n.coin.amount, 8)} ${esc(simState.symbol)}`
    : `Precio ahora de ${esc(simState.symbol)}: <b>${priceFmt(n.coin.price)}</b> · <span class="muted">sin posición (en seguimiento)</span>`;


  if (!(Number(n.coin.amount) > 0)) {
    $('#sim-vender').innerHTML = `<header class="card-head"><div><h2>¿Y si vendo?</h2>
        <p class="card-sub">Sin posición en ${esc(simState.symbol)}</p></div></header>
      <p class="hint" style="margin:0">No tienes ${esc(simState.symbol)} en cartera, así que no hay nada que vender. Prueba la compra simulada de abajo.</p>`;
  } else if (simState.taxAt !== n.price || !simState.tax) {
    simState.tax = null;
    simState.taxAt = n.price;
    api(`/api/tax/simulate?symbol=${encodeURIComponent(simState.symbol)}&amount=${n.coin.amount}&price=${n.price}`)
      .then(d => { simState.tax = d; if (state.view === 'sim') renderSimTax(); })
      .catch(() => {});
  }
  if (Number(n.coin.amount) > 0) {
    $('#sim-vender').innerHTML = `<header class="card-head"><div><h2>¿Y si vendo?</h2><p class="card-sub">Vender toda la posición a ${priceFmt(n.price)}</p></div></header><div id="sim-vender-body" class="sim-lines">Calculando…</div>`;
    if (simState.tax) renderSimTax();
  }

  // compra a precio de HOY y efecto en la venta al precio objetivo
  const mercado = Number(n.coin.price) || 0;
  const importe = Number(simState.buyAmount) || 0;
  const unidades = mercado > 0 ? importe / mercado : 0;
  $('#sim-comprar').innerHTML = `<header class="card-head"><div><h2>¿Y si invierto más?</h2>
      <p class="card-sub">Comprar al precio de hoy (${priceFmt(mercado)}) y vender a ${priceFmt(n.price)}</p></div></header>
    <div class="form-row" style="margin-bottom:10px">
      <label class="field"><span>Invertir (€)</span>
        <input id="sim-buy-eur" type="number" step="any" min="0" inputmode="decimal" value="${esc(simState.buyAmount)}"></label>
      <label class="field"><span>Comprarías</span>
        <input id="sim-buy-qty" readonly value="${num(unidades, 8)} ${esc(simState.symbol)}"></label>
    </div>
    <div id="sim-buy-body" class="buy-wrap"><p class="muted tiny">Calculando…</p></div>`;
  renderSimBuy(unidades);

  renderSimPosicion();
  renderSimExtras(n, r);
  renderSimSaved();
}

function renderSimPosicion() {
  const box = $('#sim-resumen');
  if (!box) return;
  const n = simNumbers();
  if (!n) return;
  const c = n.coin;
  if (!(Number(c.amount) > 0)) {
    box.innerHTML = `<header class="card-head">
        <div><h2>${esc(c.symbol)} a ${priceFmt(n.price)}</h2>
        <p class="card-sub">No tienes posición en esta moneda</p></div>
      </header>
      <p class="hint" style="margin:0">Está en <b>Seguimiento</b>. Usa la tarjeta <b>«¿Y si invierto más?»</b> para simular una compra a precio de hoy y ver cuánto ganarías si vendes a ${priceFmt(n.price)}.</p>`;
    return;
  }
  const invertido = Number(c.invested) || 0;
  const objetivo = n.newCoinValue;
  const bruto = objetivo - invertido;
  const t = simState.tax && simState.tax.ok ? simState.tax : null;
  const impuestos = t && Number(t.price) === Number(simState.price) ? (Number(t.fifo && t.fifo.tax) || 0) : null;
  const neto = impuestos === null ? null : bruto - impuestos;
  const pct = invertido > 0 ? (bruto / invertido) * 100 : null;
  const fila = (etiqueta, valor, clase) => `<div class="pos-line"><span>${etiqueta}</span><b class="${clase || ''}">${valor}</b></div>`;

  box.innerHTML = `<header class="card-head">
      <div><h2>Tu ${esc(c.symbol)} a ${priceFmt(n.price)}</h2>
      <p class="card-sub">Lo que has puesto, lo que valdría y lo que te llevas de verdad.</p></div>
    </header>
    <div class="pos-grid">
      ${fila('Inversión total', invertido ? eur(invertido) : '—')}
      ${fila('Cantidad', num(c.amount, 8) + ' ' + esc(c.symbol))}
      ${fila('Precio medio de compra', c.costKnown ? priceFmt(c.avgPrice) : '—')}
      ${fila('Valdría a ' + priceFmt(n.price), eur(objetivo))}
      ${fila('Beneficio bruto', (bruto >= 0 ? '+' : '') + eur(bruto) + (pct === null ? '' : ` (${(pct >= 0 ? '+' : '') + num(pct, 1)} %)`), bruto >= 0 ? 'pos' : 'neg')}
      ${fila('Impuestos estimados', impuestos === null ? 'calculando…' : '−' + eur(impuestos))}
      ${fila('Beneficio neto', neto === null ? 'calculando…' : (neto >= 0 ? '+' : '') + eur(neto), neto === null ? '' : (neto >= 0 ? 'pos' : 'neg'))}
    </div>
    <p class="hint" style="margin:10px 0 0">${bruto >= 0 ? 'Beneficio = valor a ese precio − lo que invertiste. Los impuestos salen del cálculo FIFO de tus compras reales.' : 'A ese precio estarías por debajo de lo invertido: no habría beneficio que declarar.'}</p>`;
}

async function renderSimBuy(unidades) {
  const body = $('#sim-buy-body');
  if (!body) return;
  const n = simNumbers();
  if (!n) return;
  const qty = Number(unidades) || (Number(simState.buyAmount) / (Number(n.coin.price) || 1));
  if (!(qty > 0)) { body.innerHTML = '<p class="muted tiny">Escribe cuánto quieres invertir.</p>'; return; }
  try {
    const d = await api(`/api/simulate/buy?symbol=${encodeURIComponent(simState.symbol)}&qty=${qty}&target=${n.price}`);
    if (state.view !== 'sim') return;
    const o = d.antes, x = d.despues, k = d.diferencia;
    const sgn = (v) => (v >= 0 ? '+' : '');
    const cls = (v) => (v >= 0 ? 'pos' : 'neg');
    const cambio = Number(k.beneficioNeto) || 0;
    const tarjeta = (titulo, sub, datos, destacado) => `
      <div class="buy-card${destacado ? ' is-now' : ''}">
        <div class="buy-card-head"><span>${titulo}</span><small>${sub}</small></div>
        ${datos.map(([k2, v, clase]) => `<div class="buy-line"><span>${k2}</span><b class="${clase || ''}">${v}</b></div>`).join('')}
      </div>`;

    body.innerHTML = `
      <div class="buy-compare">
        ${tarjeta('Ahora', 'tu cartera real', [
          ['Cantidad', num(o.cantidad, 6)],
          ['Precio medio', o.cantidad > 0 ? priceFmt(o.media) : '—'],
          ['Invertido', eur(o.invertido)],
          ['Valdría a ' + priceFmt(d.target), eur(o.ingreso)],
          ['Impuestos', eur(o.impuestos)],
          ['Beneficio neto', sgn(o.beneficioNeto) + eur(o.beneficioNeto), cls(o.beneficioNeto)],
        ], true)}
        <div class="buy-arrow" aria-hidden="true">→</div>
        ${tarjeta('Con ' + eur(Number(simState.buyAmount) || 0), 'cartera + simulación', [
          ['Cantidad', num(x.cantidad, 6)],
          ['Precio medio', priceFmt(x.media)],
          ['Invertido', eur(x.invertido)],
          ['Valdría a ' + priceFmt(d.target), eur(x.ingreso)],
          ['Impuestos', eur(x.impuestos)],
          ['Beneficio neto', sgn(x.beneficioNeto) + eur(x.beneficioNeto), cls(x.beneficioNeto)],
        ])}
      </div>
      <p class="buy-summary ${cambio > 0 ? 'pos' : cambio < 0 ? 'neg' : ''}">${Math.abs(cambio) < 0.01
        ? `Comprar y vender al mismo precio <b>no cambia tu beneficio neto</b>: los ${eur(Number(simState.buyAmount) || 0)} que pones los recuperas al vender.`
        : `Tu beneficio neto ${cambio > 0 ? 'mejora' : 'empeora'} <b>${sgn(cambio)}${eur(cambio)}</b>${k.rentabilidad !== null ? ` (${num(k.rentabilidad, 0)} % sobre los ${eur(k.invertido)} que pones)` : ''}.`}</p>`;
  } catch (e) {
    body.innerHTML = `<p class="muted tiny">${esc(e.message)}</p>`;
  }
}

function renderSimTax() {
  const body = $('#sim-vender-body');
  if (!body) return;
  const t = simState.tax;
  if (!t || !t.ok) { body.innerHTML = `<p class="muted tiny">${esc((t && t.message) || 'No se pudo calcular.')}</p>`; return; }
  const fifo = t.fifo || {};
  const gain = Number(fifo.gain) || 0;
  renderSimPosicion();
  body.innerHTML = `
    <div><span>Ingreso</span><b>${eur(t.proceeds)}</b></div>
    <div><span>Coste FIFO</span><b>${eur(fifo.cost)}</b></div>
    <div><span>Resultado</span><b class="${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}${eur(gain)}</b></div>
    <div><span>Impuestos estimados</span><b>${eur(fifo.tax)}</b></div>
    <div><span>Te quedarían</span><b>${eur(t.netAfterTax)}</b></div>
    <p class="hint" style="margin:10px 0 0">${gain > 0 ? 'Se aplican los tramos del ahorro sobre la ganancia.' : 'Si vendes con pérdidas no tributas: se compensan en la declaración.'}</p>`;
}

function renderSimExtras(n, r) {
  const box = $('#sim-extras');
  if (!box) return;
  const avg = Number(n.coin.avgPrice) || 0;
  const need = n.price > 0 && avg > 0 ? ((avg / n.price) - 1) * 100 : null;
  const target = avg > 0 ? avg * 0.9 : 0;
  const b = target > n.price ? (n.coin.invested - target * n.coin.amount) / (target - n.price) : -1;
  const bText = b > 0 ? `${eur(b)} a ${priceFmt(n.price)} te dejarían la media en ${priceFmt(target)}` : 'a ese precio no se puede bajar la media comprando';

  const hoy = Number(n.coin.price) || 0;
  const veces = hoy > 0 && r.ath ? r.ath / hoy : null;
  box.innerHTML = `<header class="card-head"><div><h2>Datos que ayudan</h2><p class="card-sub">Equilibrio, histórico y cuánto haría falta.</p></div></header>
    <div class="sim-kpis">
      <div class="stat"><span>Precio actual</span><strong>${priceFmt(hoy)}</strong><small>${n.coin.dayChangePct === null || n.coin.dayChangePct === undefined ? 'ahora mismo' : `hoy ${n.coin.dayChangePct >= 0 ? '+' : ''}${num(n.coin.dayChangePct, 2)} %`}</small></div>
      <div class="stat"><span>Máximo histórico</span><strong>${r.ath ? priceFmt(r.ath) : '—'}</strong><small>${veces ? `${num(veces, 1)}× el precio de hoy` : 'sin dato histórico'}</small></div>
      <div class="stat"><span>Precio de equilibrio</span><strong>${avg ? priceFmt(avg) : '—'}</strong><small>${need === null ? '' : `estás ${need >= 0 ? '+' : ''}${num(need, 1)} % de ahí`}</small></div>
      <div class="stat"><span>Si hubieras vendido en máx. histórico</span><strong>${r.ath && n.coin.amount > 0 ? eur(n.coin.amount * r.ath) : '—'}</strong><small>${n.coin.amount > 0 ? (r.ath ? 'bruto, antes de impuestos' : 'sin dato histórico') : 'sin posición'}</small></div>
      <div class="stat"><span>Para bajar tu media un 10 %</span><strong>${b > 0 ? eur(b) : '—'}</strong><small>${bText}</small></div>
      <div class="stat"><span>Diferencia con tu media</span><strong>${n.vsAvg === null ? '—' : (n.vsAvg >= 0 ? '+' : '') + num(n.vsAvg, 1) + ' %'}</strong><small>precio frente a ${avg ? priceFmt(avg) : '—'}</small></div>
    </div>`;
}

function renderSimSaved() {
  const box = $('#sim-guardados');
  if (!box) return;
  const list = simSaved();
  const p = state.portfolio;
  box.innerHTML = `<header class="card-head">
      <div><h2>Escenarios guardados</h2><p class="card-sub">Compara varios precios a la vez.</p></div>
      <button class="btn btn-ghost btn-xs" id="sim-save">Guardar el actual</button>
    </header>
    ${list.length ? `<table class="table"><thead><tr><th>Moneda</th><th class="num">Precio</th><th class="num">Valdría</th><th class="num">Beneficio</th><th></th></tr></thead><tbody>
      ${list.map((s, i) => {
        const c = ((p && p.coins) || []).find(x => x.symbol === s.symbol);
        if (!c) return '';
        const valor = c.amount * s.price;
        const delta = valor - (Number(c.invested) || 0);
        return `<tr><td>${esc(s.symbol)}</td><td class="num">${priceFmt(s.price)}</td><td class="num">${eur(valor)}</td>
          <td class="num ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${eur(delta)}</td>
          <td class="num"><button class="btn btn-ghost btn-xs" data-sim-del="${i}">Quitar</button></td></tr>`;
      }).join('')}</tbody></table>` : '<p class="muted tiny">Todavía no has guardado ninguno. Ajusta un precio y pulsa «Guardar el actual».</p>'}`;
}

async function boot() {
  showApp();
  await loadMe();
  if (state.me && state.me.role === 'admin') { applyAdminUi(); return; }
  document.body.classList.remove('is-admin');
  await loadCoinIcons();
  await Promise.all([loadOverview(true), loadFearGreed(), loadHistory(), loadSettings(), loadTransactions(), loadAppearance()]);
  loadSparklines();
  loadRadar();
  loadLiquidity();
  loadLeverage();
  loadPulse();
  loadCalendar();
  loadNews();
  loadRanges();
  loadWatch();
  loadMercados().then(() => { if (state.view === 'dashboard') watchRender(); });
  navigate(location.hash.startsWith('#/') ? location.hash.slice(2) : 'dashboard');
  setTimeout(rollKpiNumbers, 220);
}

async function loadOverview(force) {
  try {
    const data = await api('/api/overview' + (force ? '?force=1' : ''));
    state.status = data.status;
    state.portfolio = data.portfolio;
    renderStatus();
    renderDashboard();
    renderBanner();
    if (state.view === 'coins') renderCoins();
    if (state.view === 'settings') renderImportStatus();
  } catch (e) {
    if (e.message !== 'sin sesión') toast('No se pudo cargar la cartera: ' + e.message, true);
  }
}

async function loadHistory() {
  try {
    const data = await api('/api/history');
    state.history = data;
  } catch {}
}

async function loadEvolution() {
  if (state.evolution) return state.evolution;
  try {
    const data = await api('/api/evolution');
    if (data && data.ok) state.evolution = data;
  } catch {}
  return state.evolution;
}

async function loadFearGreed() {
  try {
    state.fearGreed = await api('/api/fear-greed');
  } catch {
    state.fearGreed = null;
  }
  renderFearGreed();
  renderFearGreedMini();
}

async function loadTransactions() {
  try {
    const data = await api('/api/transactions');
    state.transactions = data.rows || [];
    renderOperations();
  } catch {}
}

async function loadSettings() {
  try {
    state.settings = await api('/api/settings');
    navPrepareHandles();
    if (state.settings && state.settings.navOrder) navApplyOrder(state.settings.navOrder);
    state.cold = await api('/api/holdings');
    state.overrides = await api('/api/overrides');
    const wk = $('#tg-weekly');
    if (wk && state.settings && state.settings.weekly) wk.checked = !!state.settings.weekly.enabled;
    await loadNotify();
  } catch {}
}

/* ------------------------------------------------ estado / banner */
function renderStatus() {
  const s = state.status || {};
  const chip = $('#mode-chip');
  const mode = s.mode || 'demo';
  chip.textContent = mode === 'live' ? 'LIVE' : mode === 'history' ? 'HISTORIAL' : 'DEMO';
  chip.className = 'chip chip-mode ' + (mode === 'live' ? 'live' : mode === 'history' ? 'history' : 'demo');
  const parts = [];
  if (s.lastSyncAt) parts.push('sincronizado ' + relTime(s.lastSyncAt));
  else if (s.configured) parts.push('sin sincronizar');
  else if (mode === 'history') parts.push('datos del CSV');
  else parts.push('sin claves');
  $('#sync-info').textContent = parts.join(' · ');
  const updated = state.portfolio ? state.portfolio.updatedAt : null;
  if (updated) $('#page-sub').textContent = (VIEW_TITLES[state.view] || ['', ''])[1] + ' · actualizado ' + relTime(Date.parse(updated));
}

const dismissedBanners = new Set();

function renderBanner() {
  const el = $('#banner');
  const warnings = (state.portfolio && state.portfolio.warnings) || [];
  const extra = [];
  if (state.status && state.status.keysError) extra.push({ level: 'warn', text: state.status.keysError });
  if (state.status && state.status.error) extra.push({ level: 'warn', text: state.status.error });
  const all = extra.concat(warnings).filter(w => !dismissedBanners.has(w.code || w.text));
  if (!all.length) { el.classList.add('hidden'); return; }
  const first = all[0];
  const key = first.code || first.text;
  el.className = 'banner' + (first.level === 'info' ? ' info' : '');
  el.innerHTML = `<span>${first.level === 'info' ? 'ℹ️' : '⚠️'}</span><span>${esc(first.text)}</span>` +
    (all.length > 1 ? `<span class="tiny muted">(+${all.length - 1})</span>` : '') +
    `<button class="banner-close" type="button" aria-label="Cerrar aviso">×</button>`;
  const close = el.querySelector('.banner-close');
  if (close) close.addEventListener('click', () => { dismissedBanners.add(key); renderBanner(); });
}

/* ============================================================
   RESUMEN
   ============================================================ */
/* KPIs compartidos: misma fila de resumen en las pestañas de contenido */
function renderSharedKpis(p) {
  if (!p) return;
  document.querySelectorAll('[data-kpis]').forEach(box => {
    const set = (k, html, cls) => {
      const el = box.querySelector('[data-k="' + k + '"]');
      if (!el) return;
      el.innerHTML = html;
      if (cls !== undefined) el.className = cls;
    };
    set('value', eur(p.totalValue));
    set('value-sub', `<span>${eur(p.cryptoValue)} en cripto</span>${p.cash ? `<span class="dot-sep">·</span><span>${eur(p.cash)} en efectivo</span>` : ''}`);
    set('invested', eur(p.invested));
    set('invested-sub', `<span>${p.coinCount} ${p.coinCount === 1 ? 'moneda' : 'monedas'}</span>`);
    set('pnl', (p.pnl >= 0 ? '+' : '') + eur(p.pnl), 'kpi-value ' + signed(p.pnl));
    set('pnl-sub', `<span class="${signed(p.pnl)}">${arrow(p.pnl)} ${pct(p.pnlPct)}</span><span>sobre lo invertido</span>`);
    set('today', (p.dayChangeValue >= 0 ? '+' : '') + eur(p.dayChangeValue), 'kpi-value ' + signed(p.dayChangeValue || 0));
    set('today-sub', `<span class="${signed(p.dayChangeValue || 0)}">${arrow(p.dayChangeValue || 0)} ${pct(p.dayChangePct)}</span><span>últimas 24 h</span>`);
  });
}

function renderDashboard() {
  const p = state.portfolio;
  if (!p) return;
  const set = (id, html, cls) => { const el = document.getElementById(id); if (el) { el.innerHTML = html; if (cls !== undefined) el.className = cls; } };

  set('kpi-value', eur(p.totalValue));
  set('kpi-value-sub', `<span>${eur(p.cryptoValue)} en cripto</span>${p.cash ? `<span class="dot-sep">·</span><span>${eur(p.cash)} en efectivo</span>` : ''}`);
  set('kpi-invested', eur(p.invested));
  set('kpi-invested-sub', `<span>${p.coinCount} ${p.coinCount === 1 ? 'moneda' : 'monedas'}</span>`);
  set('kpi-pnl', (p.pnl >= 0 ? '+' : '') + eur(p.pnl), 'kpi-value ' + signed(p.pnl));
  set('kpi-pnl-sub', `<span class="${signed(p.pnl)}">${arrow(p.pnl)} ${pct(p.pnlPct)}</span><span>sobre lo invertido</span>`);
  set('kpi-today', (p.dayChangeValue >= 0 ? '+' : '') + eur(p.dayChangeValue), 'kpi-value ' + signed(p.dayChangeValue || 0));
  set('kpi-today-sub', `<span class="${signed(p.dayChangeValue || 0)}">${arrow(p.dayChangeValue || 0)} ${pct(p.dayChangePct)}</span><span>últimas 24 h</span>`);

  renderSharedKpis(p);

  renderEvolutionChart();
  renderAllocation();
  renderTopCoins();
  renderFearGreedMini();
}

function rangeCut(range) {
  const now = Date.now();
  const day = 86400e3;
  if (range === '1M') return now - 30 * day;
  if (range === '3M') return now - 90 * day;
  if (range === '6M') return now - 182 * day;
  if (range === '1A') return now - 365 * day;
  return 0;
}

async function renderEvolutionChart() {
  const v = themeVars();
  const hist = (state.history.points || []).slice();
  const evo = await loadEvolution();

  let points = [];
  let source = '';
  if (evo && Array.isArray(evo.points) && evo.points.length > 4) {
    // Serie reconstruida desde el historial importado (cubre desde la primera compra).
    points = evo.points.map(p => ({ t: p.t, value: p.value, invested: p.invested }));
    source = 'reconstruida desde tu historial';
    // Enlazamos con las capturas de hoy posteriores al último punto de la serie.
    if (hist.length) {
      const lastT = points.length ? points[points.length - 1].t : 0;
      const extra = hist.filter(p => p.t > lastT).map(p => ({ t: p.t, value: p.value, invested: p.invested }));
      if (extra.length) points = points.concat(extra);
    }
  } else if (hist.length > 1) {
    points = hist;
    source = 'guardada cada ' + (state.history.intervalMin || 5) + ' min';
  }

  const cut = rangeCut(state.range);
  let filtered = points.filter(p => p.t >= cut);
  // Si el rango elegido deja menos de 2 puntos, mostramos toda la serie en vez de un vacío.
  if (filtered.length < 2 && points.length >= 2) filtered = points;
  const el = $('#chart-evolution');
  if (!filtered.length) {
    clearChart('chart-evolution', '<div class="empty">Aún no hay histórico. Importa tu CSV y se reconstruirá la evolución.</div>');
    return;
  }
  if (el && el.querySelector('.empty')) el.innerHTML = '';

  const sub = $('#evo-sub');
  if (sub) {
    const desde = new Date(filtered[0].t).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    sub.textContent = `${filtered.length} puntos · desde ${desde} · ${source}`;
  }

  const values = filtered.map(p => p.value);
  const invested = filtered.map(p => p.invested);
  const min = Math.min(...values, ...invested);
  const max = Math.max(...values, ...invested);
  const pad = (max - min) * 0.08 || max * 0.05 || 1;

  chart('chart-evolution', {
    animationDuration: 500,
    grid: { left: 4, right: 12, top: 20, bottom: 4, containLabel: true },
    tooltip: {
      ...baseTooltip(v),
      formatter: (items) => {
        if (!items || !items.length) return '';
        const t = new Date(items[0].value[0]).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        const rows = items.map(i => `<div style="display:flex;justify-content:space-between;gap:18px"><span style="opacity:.7">${i.seriesName}</span><b>${eur(i.value[1])}</b></div>`);
        return `<div style="margin-bottom:4px;opacity:.75">${t}</div>${rows.join('')}`;
      },
    },
    xAxis: {
      type: 'time', boundaryGap: false,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: v.muted, fontSize: 11, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', scale: true, splitNumber: 4,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: v.muted, fontSize: 11, formatter: (x) => short(x) + ' €' },
      splitLine: { lineStyle: { color: v.line, type: [4, 4] } },
    },
    series: [
      {
        name: 'Valor', type: 'line', smooth: 0.25, showSymbol: false,
        data: filtered.map(p => [p.t, p.value]),
        lineStyle: { width: 2.2, color: v.accent },
        itemStyle: { color: v.accent },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexA(v.accent, 0.32) },
            { offset: 1, color: hexA(v.accent, 0) },
          ]),
        },
      },
      {
        name: 'Invertido', type: 'line', smooth: 0.2, showSymbol: false,
        data: filtered.map(p => [p.t, p.invested]),
        lineStyle: { width: 1.4, color: v.muted, type: [5, 5] },
        itemStyle: { color: v.muted },
      },
    ],
  });
}

$$('#range-chips button').forEach(b => b.addEventListener('click', () => {
  $$('#range-chips button').forEach(x => x.classList.remove('is-active'));
  b.classList.add('is-active');
  state.range = b.dataset.range;
  renderEvolutionChart();
}));




function renderAllocation() {
  const p = state.portfolio;
  if (!p) return;
  const v = themeVars();
  const slices = p.coins.slice(0, 7).map((c, i) => ({ name: c.symbol, value: c.value, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } }));
  if (p.cash > 0) slices.push({ name: 'Efectivo', value: p.cash, itemStyle: { color: '#5b6b86' } });
  const rest = p.coins.slice(7).reduce((a, c) => a + c.value, 0);
  if (rest > 0) slices.push({ name: 'Otras', value: rest, itemStyle: { color: '#3d4a61' } });

  const sub = $('#alloc-sub');
  if (sub) sub.textContent = p.coinCount + ' monedas';

  chart('chart-allocation', {
    animationDuration: 500,
    tooltip: {
      ...baseTooltip(v), trigger: 'item',
      backgroundColor: 'rgba(8,12,20,.95)',
      borderWidth: 0,
      padding: [8, 10],
      extraCssText: 'box-shadow:0 12px 30px -14px rgba(0,0,0,.9); border-radius:10px;',
      formatter: (i) => {
        const c = typeof i.color === 'string' ? i.color : '#7c8aa5';
        return `<div style="min-width:118px;border-left:3px solid ${c};padding-left:9px">
          <div style="font-weight:650;color:${c};font-size:12.5px">${i.name}</div>
          <div style="margin-top:2px;color:#e8eefc">${eur(i.value)} · ${num(i.percent, 1)} %</div>
        </div>`;
      },
    },
    series: [{
      type: 'pie', radius: ['64%', '90%'], center: ['50%', '52%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 7, borderColor: 'transparent', borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 4 },
      data: slices,
    }],
    graphic: [{
      type: 'text', left: 'center', top: '44%',
      style: {
        text: eur0(p.totalValue),
        fill: v.text, fontSize: 18, fontWeight: 650, textAlign: 'center',
      },
    }, {
      type: 'text', left: 'center', top: '56%',
      style: { text: 'valor total', fill: v.muted, fontSize: 11, textAlign: 'center' },
    }],
  });

  const legend = $('#alloc-legend');
  if (legend) {
    const total = slices.reduce((a, s) => a + s.value, 0) || 1;
    legend.innerHTML = slices.slice(0, 5).map(s => `
      <li>
        <span class="dot" style="background:${s.itemStyle.color}"></span>
        <span class="lg-name">${esc(s.name)}</span>
        <span class="lg-val">${num((s.value / total) * 100, 1)} %</span>
      </li>`).join('');
  }
}



/* Radar del mercado: mayores subidas y bajadas del día */
function radarRow(item, up) {
  const pct = (item.change >= 0 ? '+' : '') + num(item.change, 2) + ' %';
  return `<div class="radar-row">
    ${coinBadge(item.symbol)}
    <b>${esc(item.symbol)}</b>
    <span class="radar-price">${priceFmt(item.price)}</span>
    <span class="radar-pct ${up ? 'pos' : 'neg'}">${pct}</span>
  </div>`;
}

async function loadRadar() {
  const up = $('#radar-up');
  const down = $('#radar-down');
  if (!up || !down) return;
  try {
    const r = await api('/api/radar');
    up.innerHTML = (r.up || []).map(i => radarRow(i, true)).join('') || '<p class="muted tiny">Sin datos.</p>';
    down.innerHTML = (r.down || []).map(i => radarRow(i, false)).join('') || '<p class="muted tiny">Sin datos.</p>';
  } catch {
    up.innerHTML = down.innerHTML = '<p class="muted tiny">No disponible.</p>';
  }
}

/* Minigráfico de 7 días (una sola línea, verde si sube y roja si baja) */
function sparklineWide(values) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const w = 160, h = 36, pad = 2;
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
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}



/* ------------------------------------------------ trading */
function tradeSymbols() {
  const p = state.portfolio;
  const cartera = (p && Array.isArray(p.coins) ? p.coins.map(c => c.symbol) : []);
  const seguidas = (typeof WATCH !== 'undefined' && Array.isArray(WATCH)) ? WATCH : [];
  const todos = [...new Set([...cartera, ...seguidas])];
  return todos.sort();
}

function initTradeControls() {
  const sel = $('#trade-symbol');
  if (!sel || sel.dataset.ready === '1') return;
  const syms = tradeSymbols();
  if (!syms.length) return;
  sel.innerHTML = syms.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.dataset.ready = '1';
  sel.value = state.tradeSymbol || syms[0];
  sel.addEventListener('change', () => { state.tradeSymbol = sel.value; loadTradeChart(); });
  $$('#trade-intervals button').forEach(b => b.addEventListener('click', () => {
    $$('#trade-intervals button').forEach(x => x.classList.toggle('is-active', x === b));
    if (b.dataset.iv === 'all') {
      state.tradeAll = true;
    } else {
      state.tradeAll = false;
      state.tradeInterval = b.dataset.iv;
    }
    loadTradeChart();
  }));
  $$('#trade-wolfe button').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.wolfe;
    if (act === 'clear') state.wolfe = { mode: 'off', pts: [] };
    else state.wolfe = { mode: state.wolfe.mode === act ? 'off' : act, pts: [] };
    $$('#trade-wolfe button').forEach(x => x.classList.toggle('is-active', x.dataset.wolfe === state.wolfe.mode));
    loadTradeChart();
  }));
  $$('#trade-indicators button').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.ind;
    state.tradeInd[key] = !state.tradeInd[key];
    b.classList.toggle('is-active', state.tradeInd[key]);
    loadTradeChart();
  }));
}

async function loadTradeChart() {
  initTradeControls();
  const syms = tradeSymbols();
  const sym = state.tradeSymbol || syms[0];
  const stats = $('#trade-stats');
  if (!sym) { if (stats) stats.textContent = 'Sin monedas en la cartera.'; return; }
  state.tradeSymbol = sym;
  const sel = $('#trade-symbol');
  if (sel && sel.value !== sym) sel.value = sym;
  const iv = state.tradeInterval || '1h';
  if (stats) stats.textContent = 'Cargando…';
  try {
    const limite = state.tradeAll ? 1000 : 300;
    const r = await api(`/api/candles?symbol=${encodeURIComponent(sym)}&interval=${iv}&limit=${limite}`);
    renderCandles(sym, iv, r.candles || []);
    loadRegime(sym);
    loadRegimeWatch();
    // Análisis automático la primera vez para cada moneda e intervalo
    if (state.analystKey !== analystKeyFor(sym, iv) && $('#analyst-btn')) runAnalyst();
  } catch (e) {
    if (stats) stats.textContent = 'Sin datos: ' + e.message;
  }
}

/* --- medias e indicadores (cálculo local, sin librerías) --- */
function sma(arr, n) {
  return arr.map((_, i) => (i < n - 1 ? '-' : arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
}
function ema(arr, n) {
  const k = 2 / (n + 1);
  let prev = null;
  return arr.map((v, i) => {
    if (i < n - 1) return '-';
    if (prev === null) { prev = arr.slice(0, n).reduce((a, b) => a + b, 0) / n; return prev; }
    prev = v * k + prev * (1 - k);
    return prev;
  });
}
function stdev(arr, n, mean) {
  return arr.map((_, i) => {
    if (i < n - 1) return '-';
    const slice = arr.slice(i - n + 1, i + 1);
    const m = mean[i] === '-' ? slice.reduce((a, b) => a + b, 0) / n : mean[i];
    return Math.sqrt(slice.reduce((a, b) => a + (b - m) * (b - m), 0) / n);
  });
}
function rsiSeries(closes, n = 14) {
  const out = closes.map(() => '-');
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
function macdSeries(closes) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const dif = closes.map((_, i) => (fast[i] === '-' || slow[i] === '-' ? '-' : fast[i] - slow[i]));
  const filled = dif.map(v => (v === '-' ? 0 : v));
  const sig = ema(filled, 9);
  const hist = dif.map((v, i) => (v === '-' ? '-' : (v - sig[i]) * 2));
  return { dif, sig, hist };
}

/* --- Ondas de Wolfe: pivotes, detección automática y dibujo --- */
function zigzagPivots(rows, k = 5) {
  const out = [];
  for (let i = k; i < rows.length - k; i++) {
    const hi = rows[i][2];
    const lo = rows[i][3];
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (rows[j][2] >= hi) isH = false;
      if (rows[j][3] <= lo) isL = false;
    }
    if (isH) out.push({ i, price: hi, type: 'H' });
    else if (isL) out.push({ i, price: lo, type: 'L' });
  }
  return out;
}

function detectWolfe(rows, k = 5) {
  const raw = zigzagPivots(rows, k);
  if (raw.length < 5) return null;
  // comprimir pivotes seguidos del mismo tipo, quedándonos con el extremo
  const seq = [];
  for (const q of raw) {
    const last = seq[seq.length - 1];
    if (!last) { seq.push(q); continue; }
    if (last.type === q.type) {
      if ((q.type === 'H' && q.price > last.price) || (q.type === 'L' && q.price < last.price)) seq[seq.length - 1] = q;
    } else seq.push(q);
  }
  if (seq.length < 5) return null;
  const [p1, p2, p3, p4, p5] = seq.slice(-5);
  if (p1.type === 'L') {
    // Wolfe alcista: 2 por encima de 1 y 3 · 4 por debajo de 2 · 5 por encima de 3
    if (!(p2.price > p1.price && p2.price > p3.price)) return null;
    if (!(p3.price < p2.price && p4.price < p2.price)) return null;
    if (!(p4.price > p3.price)) return null;
    if (!(p5.price > p3.price)) return null;
  } else {
    if (!(p2.price < p1.price && p2.price < p3.price)) return null;
    if (!(p3.price > p2.price && p4.price > p2.price)) return null;
    if (!(p4.price < p3.price)) return null;
    if (!(p5.price < p3.price)) return null;
  }
  return [p1, p2, p3, p4, p5];
}

/* Línea EPA: prolongación de 1-3 hasta el final del gráfico */
function epaLine(pts, lastIdx) {
  const a = pts[0];
  const b = pts[2];
  if (!a || !b || b.i === a.i) return [];
  const slope = (b.price - a.price) / (b.i - a.i);
  return [[a.i, a.price], [lastIdx, a.price + slope * (lastIdx - a.i)]];
}

function wolfePoints(rows) {
  const mode = state.wolfe ? state.wolfe.mode : 'off';
  if (mode === 'auto') return detectWolfe(rows) || [];
  if (mode === 'manual') return (state.wolfe.pts || []).slice(0, 5);
  return [];
}

function wolfeSeries(rows) {
  const v = themeVars();
  const pts = wolfePoints(rows);
  const data = pts.map(p => [p.i, p.price]);
  const epa = pts.length >= 3 ? epaLine(pts, rows.length - 1) : [];
  return [
    {
      id: 'wolfe', name: 'Wolfe', type: 'line', data, symbol: 'circle', symbolSize: 6,
      lineStyle: { color: '#f0b429', width: 1.8 }, itemStyle: { color: '#f0b429' },
      label: { show: true, position: 'top', color: '#f0b429', fontSize: 10, formatter: (p) => String(p.dataIndex + 1) },
      xAxisIndex: 0, yAxisIndex: 0, z: 6, tooltip: { show: false },
    },
    {
      id: 'wolfeEpa', name: 'EPA', type: 'line', data: epa, symbol: 'none',
      lineStyle: { color: hexA('#f0b429', .55), width: 1, type: 'dashed' },
      xAxisIndex: 0, yAxisIndex: 0, z: 5, tooltip: { show: false },
    },
  ];
}

function updateWolfe(inst, rows) {
  if (!inst) return;
  const [w, e] = wolfeSeries(rows);
  inst.setOption({ series: [{ id: 'wolfe', data: w.data }, { id: 'wolfeEpa', data: e.data }] });
  const stats = $('#trade-stats');
  if (stats && state.wolfe.mode === 'manual') {
    const n = (state.wolfe.pts || []).length;
    stats.innerHTML = n >= 5
      ? 'Wolfe manual: <b>5/5</b> puntos · pulsa ✕ para borrar'
      : `Wolfe manual: marca <b>${n}/5</b> puntos en el gráfico`;
  }
}

function bindWolfeClicks(inst, rows) {
  if (!inst) return;
  inst.getZr().off('click');
  inst.getZr().on('click', (e) => {
    if (!state.wolfe || state.wolfe.mode !== 'manual') return;
    const p = inst.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return;
    const i = Math.max(0, Math.min(rows.length - 1, Math.round(p[0])));
    state.wolfe.pts.push({ i, price: p[1] });
    if (state.wolfe.pts.length > 5) state.wolfe.pts = state.wolfe.pts.slice(-5);
    updateWolfe(inst, rows);
  });
}

/* ------------------------------------------------ analista determinista */
function analystKeyFor(sym, iv) {
  const ind = Object.keys(state.tradeInd || {}).filter(k => state.tradeInd[k]).sort().join(',');
  const w = (state.wolfe && state.wolfe.mode) || 'off';
  return `${sym}|${iv}|${ind}|${w}`;
}

async function runAnalyst() {
  const out = $('#analyst-out');
  const sub = $('#analyst-sub');
  const btn = $('#analyst-btn');
  if (!out) return;
  const sym = state.tradeSymbol || (tradeSymbols()[0] || '');
  const iv = state.tradeInterval || '1h';
  if (!sym) { out.innerHTML = '<p class="muted tiny">Sin monedas en la cartera.</p>'; return; }
  state.analystKey = analystKeyFor(sym, iv);
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
  try {
    const ind = Object.keys(state.tradeInd || {}).filter(k => state.tradeInd[k]).join(',');
    const wolfeOn = state.wolfe && state.wolfe.mode && state.wolfe.mode !== 'off';
    const d = await api(`/api/analyze?symbol=${encodeURIComponent(sym)}&interval=${iv}&ind=${encodeURIComponent(ind)}`);
    if (!d.ok) throw new Error(d.error || 'Sin datos');
    if (sub) sub.textContent = `${sym} · ${iv} · ${new Date(d.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    const extra = [];
    if (wolfeOn) {
      const pts = (typeof detectWolfe === 'function' && state.tradeRows) ? detectWolfe(state.tradeRows) : null;
      extra.push({
        title: 'Wolfe',
        text: pts && pts.length >= 5
          ? `Patrón detectado con ${pts.length} puntos; el quinto en ${priceFmt(pts[4].price)}. Objetivo estimado (línea EPA) hacia ${priceFmt(pts[2].price)}.`
          : 'Sin patrón Wolfe claro con las velas actuales. Si lo ves a mano, activa «Wolfe → Lápiz» y márcalo.',
      });
    }
    out.innerHTML = (d.sections || []).concat(extra).map(s => `
      <div class="analyst-block">
        <span class="analyst-title">${esc(s.title)}</span>
        <p>${esc(s.text)}</p>
      </div>`).join('') +
      `<details class="analyst-facts"><summary>Números usados</summary>
        <div class="analyst-facts-grid">${(d.facts || []).map(f => `<span>${esc(f.label)}</span><b>${esc(f.value)}</b>`).join('')}</div>
      </details>`;
  } catch (e) {
    out.innerHTML = `<p class="muted tiny">${esc(e.message)}</p>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Analizar'; }
  }
}

$('#analyst-btn')?.addEventListener('click', runAnalyst);

function renderCandles(symbol, interval, rows) {
  state.tradeRows = rows;
  const prevInst = echarts.getInstanceByDom(document.getElementById('chart-trade'));
  if (prevInst) prevInst.__manualY = false;
  const stats = $('#trade-stats');
  if (!rows.length) { if (stats) stats.textContent = 'Sin velas para esa moneda.'; return; }
  const v = themeVars();
  const ind = state.tradeInd || {};
  const label = (ts) => {
    const d = new Date(ts);
    return interval === '1d'
      ? d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
      : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const cats = rows.map(r => label(r[0]));
  const ohlc = rows.map(r => [r[1], r[4], r[3], r[2]]);
  const closes = rows.map(r => r[4]);
  const vols = rows.map(r => ({ value: r[5], itemStyle: { color: r[4] >= r[1] ? hexA(v.pos, .5) : hexA(v.neg, .5) } }));
  const last = closes[closes.length - 1];
  const chg = closes.length > 1 ? ((last - closes[0]) / closes[0]) * 100 : 0;
  if (stats) {
    const wolfNote = (state.wolfe && state.wolfe.mode === 'auto' && !wolfePoints(rows).length)
      ? ' · <span class="muted">Wolfe auto: sin patrón claro</span>' : '';
    stats.innerHTML = `<b>${esc(symbol)}-EUR</b> · ${priceFmt(last)} · <span class="${signed(chg)}">${chg >= 0 ? '+' : ''}${num(chg, 2)} %</span> en el periodo${wolfNote}`;
  }

  // --- paneles según indicadores activos
  const panes = [{ key: 'price', w: 4 }, { key: 'vol', w: 1.1 }];
  if (ind.rsi) panes.push({ key: 'rsi', w: 1.3 });
  if (ind.macd) panes.push({ key: 'macd', w: 1.3 });
  const gaps = 3 * (panes.length - 1) + 6;
  const usable = 84 - gaps;
  const weight = panes.reduce((a, p) => a + p.w, 0);
  let cursor = 4;
  const grids = [], xAxes = [], yAxes = [];
  panes.forEach((pane, i) => {
    const h = (usable * pane.w) / weight;
    grids.push({ left: 8, right: 64, top: cursor + '%', height: h + '%' });
    xAxes.push({
      type: 'category', gridIndex: i, data: cats,
      axisLine: { lineStyle: { color: v.line } },
      axisLabel: { show: pane.key === panes[panes.length - 1].key, color: v.muted, fontSize: 10 },
      axisTick: { show: false }, splitLine: { show: false },
    });
    const priceAxis = pane.key === 'price';
    yAxes.push({
      gridIndex: i, scale: true, position: 'right',
      axisLabel: {
        show: priceAxis, color: v.muted, fontSize: 10,
        formatter: (n) => priceFmt(n),
      },
      splitLine: { lineStyle: { color: v.line, type: 'dashed' }, show: priceAxis },
    });
    cursor += h + 3;
  });

  const seriesList = [{
    name: symbol, type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
    itemStyle: { color: v.pos, color0: v.neg, borderColor: v.pos, borderColor0: v.neg },
  }];

  if (ind.ma) {
    seriesList.push({ name: 'MA20', type: 'line', data: sma(closes, 20), symbol: 'none', smooth: true, lineStyle: { width: 1.3, color: v.accent }, xAxisIndex: 0, yAxisIndex: 0, z: 3 });
    seriesList.push({ name: 'MA50', type: 'line', data: sma(closes, 50), symbol: 'none', smooth: true, lineStyle: { width: 1.2, color: v.accent2 }, xAxisIndex: 0, yAxisIndex: 0, z: 3 });
  }
  if (ind.boll) {
    const mid = sma(closes, 20);
    const sd = stdev(closes, 20, mid);
    const up = closes.map((_, i) => (sd[i] === '-' ? '-' : mid[i] + sd[i] * 2));
    const lo = closes.map((_, i) => (sd[i] === '-' ? '-' : mid[i] - sd[i] * 2));
    seriesList.push({ name: 'Boll +2', type: 'line', data: up, symbol: 'none', lineStyle: { width: 1, color: hexA(v.accent, .55) }, xAxisIndex: 0, yAxisIndex: 0, z: 2 });
    seriesList.push({ name: 'Boll -2', type: 'line', data: lo, symbol: 'none', lineStyle: { width: 1, color: hexA(v.accent, .55) }, xAxisIndex: 0, yAxisIndex: 0, z: 2 });
  }
  const volSeries = { name: 'Volumen', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: '60%' };
  seriesList.push(volSeries);
  seriesList.push(...wolfeSeries(rows));

  if (ind.rsi) {
    const idx = panes.findIndex(p => p.key === 'rsi');
    seriesList.push({
      name: 'RSI', type: 'line', data: rsiSeries(closes), symbol: 'none', smooth: true,
      lineStyle: { width: 1.3, color: v.accent2 }, xAxisIndex: idx, yAxisIndex: idx, z: 3,
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: hexA(v.muted, .5), type: 'dashed', width: 1 },
        label: { show: false },
        data: [{ yAxis: 70 }, { yAxis: 30 }],
      },
    });
  }
  if (ind.macd) {
    const idx = panes.findIndex(p => p.key === 'macd');
    const m = macdSeries(closes);
    seriesList.push({
      name: 'MACD', type: 'bar', data: m.hist.map(h => ({ value: h, itemStyle: { color: h === '-' ? 'transparent' : (h >= 0 ? hexA(v.pos, .55) : hexA(v.neg, .55)) } })),
      xAxisIndex: idx, yAxisIndex: idx,
    });
    seriesList.push({ name: 'Dif', type: 'line', data: m.dif, symbol: 'none', lineStyle: { width: 1.2, color: v.accent }, xAxisIndex: idx, yAxisIndex: idx });
    seriesList.push({ name: 'Señal', type: 'line', data: m.sig, symbol: 'none', lineStyle: { width: 1.1, color: v.accent2 }, xAxisIndex: idx, yAxisIndex: idx });
  }

  const inst = chart('chart-trade', {
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(8,12,20,.95)', borderWidth: 0, padding: [8, 10],
      extraCssText: 'box-shadow:0 12px 30px -14px rgba(0,0,0,.9);border-radius:10px;',
      formatter: (ps) => {
        const idx = ps && ps[0] ? ps[0].dataIndex : 0;
        const r = rows[idx];
        if (!r) return '';
        const up = r[4] >= r[1];
        return `<div style="font-size:11.5px;color:${v.muted}">${cats[idx]}</div>
          <div style="margin-top:4px;color:${up ? v.pos : v.neg};font-weight:650">${priceFmt(r[4])}</div>
          <div style="margin-top:3px;font-size:11.5px">Apertura <b>${priceFmt(r[1])}</b></div>
          <div style="font-size:11.5px">Máximo <b>${priceFmt(r[2])}</b></div>
          <div style="font-size:11.5px">Mínimo <b>${priceFmt(r[3])}</b></div>
          <div style="font-size:11.5px">Volumen <b>${num(r[5], 0)}</b></div>`;
      },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: xAxes.map((_, i) => i), start: state.tradeAll ? 0 : 55, end: 100, moveOnMouseMove: true, zoomOnMouseWheel: true, zoomOnPinch: true },
      {
        type: 'slider', xAxisIndex: xAxes.map((_, i) => i), height: 16, bottom: 6, borderColor: 'transparent',
        backgroundColor: 'rgba(255,255,255,.03)', fillerColor: 'rgba(139,164,255,.12)',
        handleStyle: { color: v.accent }, textStyle: { color: v.muted, fontSize: 10 },
        dataBackground: { lineStyle: { color: v.line }, areaStyle: { color: 'transparent' } },
      },
    ],
    series: seriesList,
  });

  // doble clic: volver al zoom inicial
  if (!inst.__dblReset) {
    inst.__dblReset = true;
    inst.getZr().on('dblclick', () => {
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: state.tradeAll ? 0 : 55, end: 100 });
    });
  }

  // Fibonacci sobre el tramo visible (se recalcula al hacer zoom)
  const spans = [[0, '0 %'], [0.236, '23,6 %'], [0.382, '38,2 %'], [0.5, '50 %'], [0.618, '61,8 %'], [0.786, '78,6 %'], [1, '100 %']];
  const applyFib = (startPct, endPct) => {
    if (!inst || !ind.fib) return;
    const a = Math.max(0, Math.floor((startPct / 100) * rows.length));
    const b = Math.min(rows.length, Math.ceil((endPct / 100) * rows.length));
    const slice = rows.slice(a, Math.max(b, a + 2));
    if (!slice.length) return;
    const hi = Math.max(...slice.map(r => r[2]));
    const lo = Math.min(...slice.map(r => r[3]));
    inst.setOption({
      series: [{
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: hexA(v.accent, .35), type: 'dashed', width: 1 },
          label: { position: 'insideStartTop', color: v.muted, fontSize: 9.5, backgroundColor: 'rgba(8,12,20,.55)', padding: [1, 4], borderRadius: 3 },
          data: spans.map(([f, name]) => ({ yAxis: hi - (hi - lo) * f, name })),
        },
      }],
    });
  };
  if (inst) {
    bindWolfeClicks(inst, rows);
    let fibTimer = null;
    inst.off('dataZoom');
    inst.on('dataZoom', () => {
      clearTimeout(fibTimer);
      fibTimer = setTimeout(() => {
        const opt = inst.getOption();
        const dz = (opt.dataZoom || [])[0] || {};
        const startPct = dz.start == null ? 55 : dz.start;
        const endPct = dz.end == null ? 100 : dz.end;
        applyFib(startPct, endPct);

        // Autoescala del precio a las velas visibles (como TradingView), salvo que
        // el usuario haya escalado el eje a mano con Shift + rueda.
        const yz = (opt.dataZoom || []).find(d => d.yAxisIndex !== undefined);
        const manualY = inst.__manualY === true
          || !!(yz && yz.start != null && !(yz.start === 0 && yz.end === 100));
        if (!manualY) {
          const a = Math.max(0, Math.floor((startPct / 100) * rows.length));
          const b = Math.min(rows.length, Math.ceil((endPct / 100) * rows.length));
          const slice = rows.slice(a, Math.max(b, a + 2));
          if (slice.length) {
            const hi = Math.max(...slice.map(r => r[2]));
            const lo = Math.min(...slice.map(r => r[3]));
            const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
            const y0 = { ...yAxes[0], min: lo - pad, max: hi + pad };
            inst.setOption({ yAxis: yAxes.map((ax, i) => (i === 0 ? y0 : ax)) }, { lazyUpdate: true });
          }
        }
      }, 120);
    });
    const dz0 = (inst.getOption().dataZoom || [])[0] || {};
    applyFib(dz0.start == null ? 55 : dz0.start, dz0.end == null ? 100 : dz0.end);
  }
}

async function loadSparklines() {
  try {
    const r = await api('/api/sparklines');
    state.sparklines = r.sparklines || {};
    if (state.view === 'coins') renderCoins();
  } catch { /* es un extra: si falla, la tabla sigue igual */ }
}








function renderTopCoins() {
  const p = state.portfolio;
  const table = $('#top-coins');
  if (!table) return;
  const rows = (p.coins || []).slice(0, 6);
  const sub = $('#top-sub');
  if (sub) sub.textContent = `${p.coinCount} posiciones · ordenadas por valor`;
  if (!rows.length) {
    table.innerHTML = '<tbody><tr><td class="empty">Sin posiciones todavía.</td></tr></tbody>';
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Moneda</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">P. medio</th><th class="num">Valor</th><th class="num">Invertido</th><th class="num">P/L</th><th class="num">Hoy</th></tr></thead>
    <tbody>${rows.map(c => `<tr data-symbol="${esc(c.symbol)}" class="clickable">
      <td><div class="coin">${coinBadge(c.symbol)}<div class="coin-name"><b>${esc(c.symbol)}</b><small>${num(c.share, 1)} %</small></div>
        ${rngBlock(c.symbol)}
      </div></td>
      <td class="num">${num(c.amount, 6)}</td>
      <td class="num">${priceFmt(c.price)}</td>
      <td class="num">${c.costKnown ? priceFmt(c.avgPrice) : '<span class="muted">n/d</span>'}</td>
      <td class="num"><b>${eur(c.value)}</b></td>
      <td class="num">${c.costKnown ? eur(c.invested) : '<span class="muted">n/d</span>'}</td>
      <td class="num ${c.pnl === null ? '' : signed(c.pnl)}">${c.pnl === null ? '<span class="muted">n/d</span>' : (c.pnl >= 0 ? '+' : '') + eur(c.pnl)}</td>
      <td class="num ${signed(c.dayChangePct || 0)}">${c.dayChangePct === null || c.dayChangePct === undefined ? '—' : pct(c.dayChangePct)}</td>
    </tr>`).join('')}</tbody>`;
  table.querySelectorAll('tr[data-symbol]').forEach(tr => tr.addEventListener('click', () => openCoin(tr.dataset.symbol)));
}

/* ------------------------------------------------ miedo y codicia */
function fgClass(key) { return key || 'neutral'; }

function renderFearGreedMini() {
  const fg = state.fearGreed;
  if (!fg || !fg.series || !fg.series.length) {
    $('#fg-value').textContent = '—';
    $('#fg-label').textContent = 'sin datos';
    return;
  }
  const v = themeVars();
  $('#fg-value').textContent = fg.value;
  const label = $('#fg-label');
  label.textContent = fg.classification ? fg.classification.text : fg.label;
  label.className = 'fg-tag ' + fgClass(fg.classification && fg.classification.key);

  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setTxt('fg-mini-week', fg.weekAgo === null || fg.weekAgo === undefined ? '—' : fg.weekAgo);
  setTxt('fg-mini-month', fg.monthAgo === null || fg.monthAgo === undefined ? '—' : fg.monthAgo);
  const last30 = fg.series.slice(-30);
  const avg30 = last30.reduce((a, p) => a + p.value, 0) / (last30.length || 1);
  setTxt('fg-mini-avg', num(avg30, 0));
  const notes = {
    'extreme-fear': 'Pánico vendedor: históricamente, zona de acumulación.',
    fear: 'Predomina el miedo; precios por debajo de su media reciente.',
    neutral: 'Mercado en equilibrio, sin excesos claros.',
    greed: 'Optimismo y entradas de dinero: conviene vigilar.',
    'extreme-greed': 'Euforia: zona de riesgo, correcciones bruscas.',
  };
  setTxt('fg-mini-note', notes[(fg.classification && fg.classification.key) || ''] || '');

  const points = fg.series.slice(-120);
  chart('chart-fg-mini', {
    animationDuration: 400,
    grid: { left: 0, right: 0, top: 6, bottom: 0 },
    xAxis: { type: 'time', show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, min: 0, max: 100 },
    tooltip: { ...baseTooltip(v), formatter: (i) => `${new Date(i[0].value[0]).toLocaleDateString('es-ES')}<br/><b>${i[0].value[1]}</b>` },
    series: [{
      type: 'line', showSymbol: false, smooth: 0.3, data: points.map(p => [p.t, p.value]),
      lineStyle: { width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: hexA(v.accent2, .35) }, { offset: 1, color: hexA(v.accent2, 0) }]) },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: v.muted, type: [3, 3], width: 1, opacity: .5 },
        data: [{ yAxis: 50 }],
        label: { show: false },
      },
    }],
    visualMap: {
      show: false, dimension: 1, seriesIndex: 0,
      pieces: [
        { lt: 25, color: '#ff6b6b' },
        { gte: 25, lt: 45, color: '#ffab5e' },
        { gte: 45, lt: 56, color: '#9aa7bd' },
        { gte: 56, lt: 76, color: '#5fd99a' },
        { gte: 76, color: '#22c98a' },
      ],
    },
  });
}

function renderFearGreed() {
  const fg = state.fearGreed;
  if (!fg || !fg.series || !fg.series.length) return;
  const v = themeVars();

  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('fg-updated', fg.stale ? 'datos guardados' : 'actualizado ' + relTime(fg.updatedAt));
  set('fg-week', fg.weekAgo === null || fg.weekAgo === undefined ? '—' : fg.weekAgo);
  set('fg-month', fg.monthAgo === null || fg.monthAgo === undefined ? '—' : fg.monthAgo);
  const last30 = fg.series.slice(-30);
  const avg = last30.reduce((a, p) => a + p.value, 0) / (last30.length || 1);
  set('fg-avg', num(avg, 0));

  const zoneColor = (val) => val <= 24 ? '#ff6b6b' : val <= 44 ? '#ffab5e' : val <= 55 ? '#9aa7bd' : val <= 75 ? '#5fd99a' : '#22c98a';
  const color = zoneColor(fg.value);

  chart('fg-gauge', {
    animationDuration: 700,
    series: [{
      type: 'gauge',
      startAngle: 210, endAngle: -30,
      min: 0, max: 100, splitNumber: 5,
      radius: '96%',
      center: ['50%', '62%'],
      progress: { show: true, width: 15, roundCap: true, itemStyle: { color } },
      pointer: { show: false },
      axisLine: {
        lineStyle: {
          width: 15,
          color: [
            [0.25, hexA('#ff6b6b', .30)],
            [0.45, hexA('#ffab5e', .30)],
            [0.56, hexA('#9aa7bd', .26)],
            [0.76, hexA('#5fd99a', .30)],
            [1, hexA('#22c98a', .34)],
          ],
        },
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: v.muted, fontSize: 10, distance: 14 },
      anchor: { show: false },
      title: { show: false },
      detail: {
        offsetCenter: [0, '6%'],
        formatter: (val) => `{v|${val}}{s|/100}`,
        rich: {
          v: { fontSize: 40, fontWeight: 650, color: v.text, fontFamily: 'inherit' },
          s: { fontSize: 14, color: v.muted, padding: [0, 0, 0, 2] },
        },
      },
      data: [{ value: fg.value }],
    }],
  });

  const cut = state.fgRange === '3M' ? 90 : state.fgRange === '1A' ? 365 : state.fgRange === '2A' ? 730 : 10000;
  const points = fg.series.filter(p => p.t >= Date.now() - cut * 86400e3);
  $('#fg-sub').textContent = `${points.length} días · ${fg.source || 'alternative.me'}`;
  const bands = [[0, 25, '#ff6b6b'], [25, 45, '#ffab5e'], [45, 56, '#9aa7bd'], [56, 76, '#5fd99a'], [76, 100, '#22c98a']];
  chart('fg-chart', {
    animationDuration: 500,
    grid: { left: 4, right: 14, top: 18, bottom: 4, containLabel: true },
    tooltip: {
      ...baseTooltip(v),
      formatter: (items) => {
        const it = items[0];
        const p = points[it.dataIndex] || {};
        return `${new Date(it.value[0]).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}<br/><b style="font-size:15px">${it.value[1]}</b> · ${esc(p.label || '')}`;
      },
    },
    xAxis: { type: 'time', boundaryGap: false, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: v.muted, fontSize: 11, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, max: 100, interval: 25, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: v.muted, fontSize: 11 }, splitLine: { lineStyle: { color: v.line, type: [4, 4] } } },
    series: [{
      type: 'line', showSymbol: false, smooth: 0.25,
      data: points.map(p => [p.t, p.value]),
      lineStyle: { width: 2 },
      areaStyle: { color: hexA(v.accent, .10) },
      markArea: {
        silent: true,
        data: bands.map(b => [{ yAxis: b[0], itemStyle: { color: hexA(b[2], .10) } }, { yAxis: b[1] }]),
        label: { show: false },
      },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: v.muted, type: [3, 3], opacity: .6 }, label: { show: false }, data: [{ yAxis: 50 }] },
    }],
    // La línea se colorea según el tramo de miedo/codicia en el que esté cada punto.
    visualMap: {
      show: false,
      dimension: 1,
      seriesIndex: 0,
      pieces: [
        { lt: 25, color: '#ff6b6b' },
        { gte: 25, lt: 45, color: '#ffab5e' },
        { gte: 45, lt: 56, color: '#9aa7bd' },
        { gte: 56, lt: 76, color: '#5fd99a' },
        { gte: 76, color: '#22c98a' },
      ],
    },
  });

  const note = $('#fg-note');
  if (note) {
    const text = {
      'extreme-fear': 'Pánico en el mercado. Históricamente suele coincidir con zonas de acumulación, pero puede seguir cayendo.',
      fear: 'Predomina el miedo. Los precios suelen estar por debajo de su media reciente.',
      neutral: 'Mercado tibio, sin excesos claros hacia un lado ni hacia el otro.',
      greed: 'Hay codicia: el mercado ha subido con fuerza y los precios suelen estar calientes.',
      'extreme-greed': 'Euforia. Zonas de riesgo alto: muchos compran tarde y las correcciones suelen ser bruscas.',
    }[fg.classification && fg.classification.key] || '';
    note.textContent = text;
  }

  const explainer = $('#fg-explainer');
  if (explainer) {
    const rows = [
      ['0 – 24', 'Miedo extremo', '#ff6b6b', 'Pánico vendedor. Oportunidad histórica para quien tenga horizonte largo.'],
      ['25 – 44', 'Miedo', '#ffab5e', 'Dudas y ventas. Suele haber descuentos frente a la media.'],
      ['45 – 55', 'Neutral', '#9aa7bd', 'Sin excesos: el mercado está en equilibrio.'],
      ['56 – 75', 'Codicia', '#5fd99a', 'Optimismo y entradas de dinero. Conviene vigilar.'],
      ['76 – 100', 'Codicia extrema', '#22c98a', 'Euforia. Zona de riesgo; muchos compran en el peor momento.'],
    ];
    explainer.innerHTML = rows.map(r => `<div>
      <h4><span class="swatch" style="background:${r[2]}"></span>${r[1]} <span class="muted tiny">${r[0]}</span></h4>
      <p>${r[3]}</p></div>`).join('') + `<div>
      <h4>Cómo se calcula</h4>
      <p>Índice diario de 0 a 100 que combina volatilidad, momentum, volumen, redes sociales, dominancia de Bitcoin y tendencia. Lo publica alternative.me.</p></div>`;
  }
}

$$('#fg-ranges button').forEach(b => b.addEventListener('click', () => {
  $$('#fg-ranges button').forEach(x => x.classList.remove('is-active'));
  b.classList.add('is-active');
  state.fgRange = b.dataset.range;
  renderFearGreed();
}));

// Monedas vive en src/views/coins.js

/* ============================================================
   OPERACIONES
   ============================================================ */
function renderOperations() {
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

/* ============================================================
   FISCAL
   ============================================================ */
async function loadTax() {
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

/* ============================================================
   AJUSTES
   ============================================================ */
function loadSettingsView() {
  renderSettings();
  renderImportStatus();
  renderColdList();
  renderAbout();
}

function renderSettings() {
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

function renderImportStatus() {
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

function renderColdList() {
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

function renderAbout() {
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
    await loadOverview(true);
    loadSettingsView();
    toast(sync.added ? `Sincronizadas ${sync.added} operaciones nuevas` : 'Sin operaciones nuevas');
  } catch (e2) { toast(e2.message, true); }
});

$('#keys-sync')?.addEventListener('click', async () => {
  const btn = $('#keys-sync');
  btn.disabled = true;
  try {
    const r = await api('/api/sync', { method: 'POST' });
    await loadOverview(true);
    toast(r.added ? `${r.added} operaciones nuevas` : 'Todo al día');
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
});

$('#keys-clear')?.addEventListener('click', async () => {
  if (!confirm('¿Borrar las claves de Bitvavo?')) return;
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ apiKey: '', apiSecret: '', clearKeys: true }) });
    await loadOverview(true);
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
    await loadOverview(true);
    await loadTransactions();
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
    await boot();
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
    await boot();
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

/* ------------------------------------------------ modal */


document.querySelectorAll('[data-close="1"]').forEach(el => el.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ------------------------------------------------ refresco */
$('#refresh-btn')?.addEventListener('click', async () => {
  const btn = $('#refresh-btn');
  btn.disabled = true;
  try {
    state.evolution = null;
    await loadOverview(true);
    await loadFearGreed();
    await loadHistory();
    if (state.view === 'operations') await loadTransactions();
    if (state.view === 'tax') await loadTax();
    toast('Datos actualizados');
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
});

function renderTelegram(tg) {
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

$('#tg-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#tg-result');
  try {
    const data = await api('/api/telegram', {
      method: 'POST',
      body: JSON.stringify({ token: $('#tg-token').value.trim(), chatId: $('#tg-chat').value.trim() }),
    });
    if (out) { out.className = 'result ok'; out.textContent = data.configured ? 'Guardado. Ya puedes enviar una prueba.' : 'Faltan el token o el chat ID.'; }
    if (data.configured) { $('#tg-token').value = ''; }
    renderTelegram(data);
    toast('Telegram guardado');
  } catch (err) {
    if (out) { out.className = 'result err'; out.textContent = err.message; }
    toast(err.message, true);
  }
});

$('#tg-test')?.addEventListener('click', async () => {
  const out = $('#tg-result');
  const btn = $('#tg-test');
  btn.disabled = true;
  try {
    await api('/api/telegram/test', { method: 'POST', body: '{}' });
    if (out) { out.className = 'result ok'; out.textContent = 'Enviado. Mira tu Telegram.'; }
    toast('Mensaje de prueba enviado');
  } catch (err) {
    if (out) { out.className = 'result err'; out.textContent = err.message; }
    toast(err.message, true);
  } finally { btn.disabled = false; }
});

/* ------------------------------------------------ apariencia (fondo y avatar) */
function appearanceUrl(kind, ts) {
  return '/api/' + kind + '?v=' + (ts || Date.now());
}

function applyWallpaper(on, ts) {
  if (on) {
    document.body.style.setProperty('--wallpaper', `url("${appearanceUrl('wallpaper', ts)}")`);
    document.body.classList.add('has-wallpaper');
  } else {
    document.body.classList.remove('has-wallpaper');
    document.body.style.removeProperty('--wallpaper');
  }
}

function applyAvatar(on, ts) {
  const btn = $('#avatar-btn');
  const img = $('#user-avatar');
  if (!btn || !img) return;
  if (on) {
    img.src = appearanceUrl('avatar', ts);
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
    img.removeAttribute('src');
  }
}

function renderAppearancePreviews(a) {
  const set = (sel, kind, has) => {
    const el = $(sel);
    if (!el) return;
    if (has) {
      el.style.backgroundImage = `url("${appearanceUrl(kind, a && a.ts && a.ts[kind])}")`;
      el.classList.add('has-img');
    } else {
      el.style.backgroundImage = '';
      el.classList.remove('has-img');
    }
  };
  set('#wallpaper-preview', 'wallpaper', !!(a && a.wallpaper));
  set('#avatar-preview', 'avatar', !!(a && a.avatar));
}

async function loadAppearance() {
  try {
    const a = await api('/api/appearance');
    applyWallpaper(a.wallpaper, a.ts && a.ts.wallpaper);
    applyAvatar(a.avatar, a.ts && a.ts.avatar);
    renderAppearancePreviews(a);
  } catch { /* sin apariencia personalizada */ }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('No se pudo leer la imagen'));
    fr.readAsDataURL(file);
  });
}

async function fileToResizedDataUrl(file, maxSide, quality) {
  // Leemos el archivo como data: URL (la CSP bloquea blob:)
  const src = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Formato de imagen no compatible (usa JPG, PNG o WebP)'));
    im.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality || 0.86);
}

async function uploadAppearance(kind, file, maxSide) {
  const data = await fileToResizedDataUrl(file, maxSide, 0.86);
  const r = await api('/api/appearance/' + kind, { method: 'POST', body: JSON.stringify({ data }) });
  if (kind === 'avatar') applyAvatar(true, r.ts); else applyWallpaper(true, r.ts);
  renderAppearancePreviews(await api('/api/appearance'));
  toast(kind === 'avatar' ? 'Foto de perfil actualizada' : 'Fondo actualizado');
}

$('#wallpaper-file')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try { await uploadAppearance('wallpaper', file, 1920); }
  catch (err) { toast(err.message, true); }
  finally { e.target.value = ''; }
});

$('#avatar-file')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try { await uploadAppearance('avatar', file, 512); }
  catch (err) { toast(err.message, true); }
  finally { e.target.value = ''; }
});

$('#wallpaper-reset')?.addEventListener('click', async () => {
  try {
    await api('/api/appearance/wallpaper', { method: 'DELETE' });
    applyWallpaper(false);
    renderAppearancePreviews(await api('/api/appearance'));
    toast('Fondo original restaurado');
  } catch (err) { toast(err.message, true); }
});

$('#avatar-reset')?.addEventListener('click', async () => {
  try {
    await api('/api/appearance/avatar', { method: 'DELETE' });
    applyAvatar(false);
    renderAppearancePreviews(await api('/api/appearance'));
    toast('Foto de perfil quitada');
  } catch (err) { toast(err.message, true); }
});

/* Foto de perfil en la pantalla de acceso (endpoint público, sin sesión) */
(async function loadLoginAvatar() {
  try {
    const res = await fetch('/appearance-public', { cache: 'no-store' });
    if (!res.ok) return;
    const a = await res.json();
    if (!a || !a.avatar) return;
    const img = document.getElementById('login-avatar');
    const wrap = document.getElementById('login-avatar-wrap');
    if (!img || !wrap) return;
    img.onload = () => wrap.classList.remove('hidden');
    img.onerror = () => wrap.classList.add('hidden');
    img.src = '/avatar?v=' + (a.ts || Date.now());
  } catch { /* sin foto */ }
})();

/* ------------------------------------------------ arranque */
function renderChartsForCurrentView() {
  if (!state.portfolio) return;
  if (state.view === 'dashboard') {
    renderEvolutionChart();
    renderAllocation();
    renderFearGreedMini();
  }
  if (state.view === 'market') renderFearGreed();
}

/* ------------------------------------------------ invitación, olvido y usuarios */
$('#invite-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#invite-form').dataset.token;
  const pass = $('#invite-pass').value;
  const err = $('#invite-error');
  err.textContent = '';
  if (pass !== $('#invite-pass2').value) { err.textContent = 'Las contraseñas no coinciden'; return; }
  try {
    const r = await fetch('/api/invite/' + encodeURIComponent(token), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = (d.problems && d.problems.length) ? 'Falta: ' + d.problems.join(', ') : (d.error || 'No se pudo crear la contraseña'); return; }
    state.me = d.user || null;
    history.replaceState(null, '', '/');
    showApp();
    await boot();
  } catch { err.textContent = 'No se pudo conectar'; }
});

$('#forgot-btn')?.addEventListener('click', async () => {
  const id = prompt('Escribe tu usuario o email. El administrador recibirá el aviso.');
  if (!id) return;
  try {
    await fetch('/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id }) });
    toast('Aviso enviado al administrador');
  } catch { toast('No se pudo enviar el aviso', true); }
});

$('#user-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#user-invite-result');
  try {
    const r = await api('/api/users', { method: 'POST', body: JSON.stringify({ username: $('#user-name').value.trim(), email: $('#user-email').value.trim(), role: $('#user-role').value }) });
    const link = location.origin + '/#/invite/' + r.inviteToken;
    out.className = 'result ok';
    out.innerHTML = `Invitación creada. Enlace (caduca en 72 h):<br><code>${esc(link)}</code>`;
    out.classList.remove('hidden');
    $('#user-name').value = ''; $('#user-email').value = '';
    await loadUsers();
  } catch (err) {
    out.className = 'result err';
    out.textContent = err.message;
    out.classList.remove('hidden');
  }
});

document.addEventListener('click', (e) => {
  const rep = e.target.closest('[data-plan-report]');
  if (rep) window.open('/api/plans/' + rep.dataset.planReport + '/report', '_blank', 'noopener');
});

document.addEventListener('click', async (e) => {
  const reset = e.target.closest('[data-user-reset]');
  const toggle = e.target.closest('[data-user-toggle]');
  const del = e.target.closest('[data-user-del]');
  const tfa = e.target.closest('[data-user-2fa]');
  try {
    if (tfa) {
      if (!confirm('¿Quitar el doble factor a este usuario? Podrá entrar solo con su contraseña.')) return;
      await api('/api/users/' + tfa.dataset.user2fa + '/2fa-reset', { method: 'POST', body: '{}' });
      toast('Doble factor desactivado', 'ok');
      await loadUsers();
      return;
    }
    if (reset) {
      const r = await api('/api/users/' + reset.dataset.userReset + '/reset', { method: 'POST', body: '{}' });
      const link = location.origin + '/#/invite/' + r.inviteToken;
      const out = $('#user-invite-result');
      out.className = 'result ok';
      out.innerHTML = `Contraseña reseteada. Enlace nuevo (72 h):<br><code>${esc(link)}</code>`;
      out.classList.remove('hidden');
      await loadUsers();
    } else if (toggle) {
      await api('/api/users/' + toggle.dataset.userToggle + '/toggle', { method: 'POST', body: '{}' });
      await loadUsers();
    } else if (del) {
      if (!confirm('¿Borrar este usuario y todos sus datos?')) return;
      await api('/api/users/' + del.dataset.userDel, { method: 'DELETE' });
      await loadUsers();
      toast('Usuario borrado');
    }
  } catch (err) { toast(err.message, true); }
});

(async function start() {
  try { const saved = localStorage.getItem('quanto-theme'); if (saved) document.documentElement.dataset.theme = saved; } catch {}
  try { if (localStorage.getItem('quanto-privacy') === '1') applyPrivacy(true, false); } catch {}
  if (location.hash.startsWith('#/invite/')) {
    await showInvite(location.hash.slice(9));
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    return;
  }
  try {
    const setup = await (await fetch('/api/setup')).json();
    if (setup && setup.needed) {
      showSetup(setup);
      if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
      return;
    }
  } catch {}
  try {
    const status = await (await fetch('/api/status')).json();
    if (!status.hasPassword) { $('#login-error').textContent = 'Sin contraseña configurada: revisa el log del contenedor.'; }
    const probe = await fetch('/api/session', { credentials: 'same-origin' });
    const probeJson = probe.ok ? await probe.json().catch(() => ({})) : {};
    if (probe.ok && probeJson.ok) {
      showApp();
      await boot();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  }
})();


/* ------------------------------------------------ régimen, riesgo y reality check */
const RISK = { regimeKey: null, regime: null, sizing: null, sizingMax: 35, realityCost: 5 };

/** Guarda la posición de un elemento en pantalla para devolverla tras re-renderizar. */
function anchorTop(el) { return el ? el.getBoundingClientRect().top : null; }
function keepAnchor(el, top) {
  if (!el || top == null) return;
  const delta = el.getBoundingClientRect().top - top;
  if (Math.abs(delta) > 1) window.scrollBy(0, delta);
}

function toneClass(t) { return t === 'up' ? 'up' : t === 'down' ? 'down' : 'flat'; }

async function loadRegime(sym, force) {
  const box = $('#regime-body');
  if (!box || !sym) return;
  if (!force && RISK.regimeKey === sym && RISK.regime) { renderRegime(RISK.regime); return; }
  const sub = $('#regime-sub');
  const card = $('#regime-card');
  const keep = anchorTop(card);
  const yaHay = box.querySelector('.regime-badges');
  if (!yaHay) box.innerHTML = '<p class="muted tiny">Calculando…</p>';
  else box.classList.add('is-loading');
  if (sub) sub.textContent = sym + ' · calculando…';
  try {
    const d = await api('/api/regime?symbol=' + encodeURIComponent(sym) + '&days=400');
    RISK.regimeKey = sym;
    RISK.regime = d;
    if (sub) sub.textContent = `${sym} · ${d.candles} velas diarias · ${new Date(d.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    renderRegime(d);
  } catch (e) {
    box.innerHTML = `<p class="muted tiny">No disponible: ${esc(e.message)}</p>`;
    if (sub) sub.textContent = sym;
  } finally {
    box.classList.remove('is-loading');
    keepAnchor(card, keep);
  }
}

function renderRegime(d) {
  const box = $('#regime-body');
  if (!box) return;
  const tone = d.trend === 'alcista' ? 'up' : d.trend === 'bajista' ? 'down' : 'flat';
  const volTone = d.volState === 'alta' ? 'down' : d.volState === 'baja' ? 'up' : 'flat';
  const badges = [
    `<span class="badge ${tone}">${d.trend === 'alcista' ? 'Tendencia alcista' : d.trend === 'bajista' ? 'Tendencia bajista' : 'Sin dirección'}</span>`,
    d.strength ? `<span class="badge flat">Fuerza ${esc(d.strength)}</span>` : '',
    d.volState ? `<span class="badge ${volTone}">Volatilidad ${esc(d.volState)}</span>` : '',
    `<span class="badge flat">Confianza ${d.confidence} %</span>`,
    `<span class="badge flat">Tamaño sugerido ${Math.round(d.riskMultiplier * 100)} %</span>`,
  ].join('');
  const facts = (d.factors || []).map(f =>
    `<div class="regime-fact"><span>${esc(f.label)}</span><strong class="${toneClass(f.tone)}">${esc(String(f.value))}</strong></div>`).join('');
  box.innerHTML = `
    <div class="regime-badges">${badges}</div>
    <p class="regime-text">${esc(d.text)}</p>
    <div class="regime-facts">${facts}</div>
    <p class="regime-advice">${esc(d.advice)}</p>`;
}

async function loadSizing(force) {
  const box = $('#sizing-body');
  if (!box) return;
  if (!force && RISK.sizing && RISK.sizing.maxWeight === RISK.sizingMax / 100) { renderSizing(RISK.sizing); return; }
  const card = $('#sizing-card');
  const keep = anchorTop(card);
  const yaHay = box.querySelector('table');
  if (!yaHay) box.innerHTML = '<p class="muted tiny" style="padding:12px">Calculando reparto por riesgo…</p>';
  else box.classList.add('is-loading');
  try {
    const d = await api('/api/sizing?max=' + RISK.sizingMax);
    RISK.sizing = d;
    renderSizing(d);
  } catch (e) {
    box.innerHTML = `<p class="muted tiny" style="padding:12px">${esc(e.message)}</p>`;
  } finally {
    box.classList.remove('is-loading');
    keepAnchor(card, keep);
  }
}

function renderSizing(d) {
  const sub = $('#sizing-sub');
  if (sub) {
    sub.textContent = `Volatilidad anual de la cartera: ${(d.portfolioVol * 100).toFixed(1)} % con el reparto sugerido (ahora ${(d.portfolioVolNow * 100).toFixed(1)} %). Riesgo al 95 % a un año: ${(d.risk95 * 100).toFixed(1)} %.`;
  }
  const rows = d.rows.map(r => {
    const delta = r.delta * 100;
    const cls = delta > 0.5 ? 'delta-up' : delta < -0.5 ? 'delta-down' : '';
    const sign = delta > 0 ? '+' : '';
    return `<tr>
      <td><b>${esc(r.symbol)}</b>${r.cash ? ' <span class="tiny muted">efectivo</span>' : ''}</td>
      <td class="num">${(r.current * 100).toFixed(1)} %</td>
      <td class="num">${(r.target * 100).toFixed(1)} %</td>
      <td class="num ${cls}">${sign}${delta.toFixed(1)} pp</td>
      <td class="num">${r.vol ? (r.vol * 100).toFixed(0) + ' %' : '—'}</td>
      <td style="width:130px;padding-right:16px"><div class="bar"><i style="width:${Math.min(100, r.target * 200)}%"></i></div></td>
    </tr>`;
  }).join('');
  $('#sizing-body').innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Moneda</th><th class="num">Ahora</th><th class="num">Objetivo</th><th class="num">Cambio</th><th class="num">Vol</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${(d.notes || []).map(n => `<p class="tiny muted" style="margin:8px 0 0">${esc(n)}</p>`).join('')}
    <p class="tiny muted" style="margin:8px 0 0">Reparto por mínima varianza con el tope elegido. Es aritmética sobre tu cartera, no una recomendación de inversión.</p>`;
}

async function loadReality(sym) {
  const box = $('#reality-body');
  if (!box || !sym) return;
  const card = $('#reality-card');
  const keep = anchorTop(card);
  const yaHay = box.querySelector('table');
  if (!yaHay) box.innerHTML = '<p class="muted tiny" style="padding:12px">Evaluando estrategias…</p>';
  else box.classList.add('is-loading');
  const note = $('#reality-note');
  if (note) note.textContent = '';
  try {
    const d = await api(`/api/reality?symbol=${encodeURIComponent(sym)}&cost=${RISK.realityCost}`);
    renderReality(d);
  } catch (e) {
    box.innerHTML = `<p class="muted tiny" style="padding:12px">${esc(e.message)}</p>`;
  } finally {
    box.classList.remove('is-loading');
    keepAnchor(card, keep);
  }
}

function renderReality(d) {
  const rows = d.rows.map(r => {
    const isBh = r.id === 'hold';
    const beats = !isBh && r.sharpe > d.bh.sharpe && r.total > d.bh.total;
    const cls = r.total > 0 ? 'reality-ok' : 'reality-bad';
    return `<tr>
      <td><b>${esc(r.name)}</b><div class="tiny muted">${esc(r.desc || '')}</div></td>
      <td class="num ${cls}">${r.total.toFixed(0)} %</td>
      <td class="num">${r.cagr.toFixed(1)} %</td>
      <td class="num">${r.sharpe.toFixed(2)}</td>
      <td class="num">${r.mdd.toFixed(0)} %</td>
      <td class="num">${r.trades || '—'}</td>
      <td class="num">${r.acc != null ? r.acc.toFixed(1) + ' %' : '—'}</td>
      <td class="num">${r.pvalue != null ? r.pvalue.toFixed(2) : '—'}</td>
      <td>${isBh ? '<span class="tiny muted">referencia</span>' : beats ? '<span class="reality-ok" title="Supera a comprar y mantener en retorno y Sharpe">bate</span>' : '<span class="tiny muted" title="No supera a comprar y mantener">no bate</span>'}</td>
    </tr>`;
  }).join('');
  $('#reality-body').innerHTML = `<table class="table">
      <thead><tr><th>Estrategia</th><th class="num">Total</th><th class="num">CAGR</th><th class="num">Sharpe</th><th class="num">MaxDD</th><th class="num">Ops</th><th class="num">Acierto</th><th class="num">p</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  const note = $('#reality-note');
  if (note) note.textContent = `${d.symbol} · ${d.days} días · coste ${d.costBps} pb · ${d.note}`;
}

let REGIME_WATCH = null;

async function loadRegimeWatch() {
  const btn = $('#regime-watch-toggle');
  if (!btn) return;
  try {
    const d = await api('/api/regime-watch');
    REGIME_WATCH = { cfg: d.cfg, channels: d.channels, at: d.at };
    renderRegimeWatch();
  } catch { /* el panel sigue funcionando sin avisos */ }
}

function renderRegimeWatch() {
  const btn = $('#regime-watch-toggle');
  const note = $('#regime-watch-state');
  if (!btn || !REGIME_WATCH) return;
  const { cfg, channels } = REGIME_WATCH;
  const on = !!cfg.enabled;
  btn.classList.toggle('is-active', on);
  btn.textContent = on ? 'Avisos activos' : 'Avisarme';
  btn.title = on ? `Revisa cada ${cfg.intervalH} h. Pulsa para desactivar.` : 'Avisarme cuando cambie la tendencia o la volatilidad';
  if (!note) return;
  const canals = [];
  if (channels.telegram) canals.push('Telegram');
  if (channels.email) canals.push('email');
  if (on && canals.length) note.textContent = `Vigilante activo: revisa cada ${cfg.intervalH} h y avisa por ${canals.join(' y ')} (máx. un aviso cada ${cfg.cooldownH} h por moneda).`;
  else if (on) note.textContent = 'Vigilante activo, pero no hay Telegram ni email configurado: los avisos no llegarán. Configúralo en Ajustes → Avisos.';
  else note.textContent = 'El vigilante está apagado. Actívalo para recibir un aviso cuando una moneda cambie de tendencia o de volatilidad.';
}

$('#regime-watch-toggle')?.addEventListener('click', async () => {
  const btn = $('#regime-watch-toggle');
  if (btn) btn.disabled = true;
  try {
    const enabled = !(REGIME_WATCH && REGIME_WATCH.cfg && REGIME_WATCH.cfg.enabled);
    const d = await api('/api/regime-watch', { method: 'POST', body: { enabled } });
    REGIME_WATCH = { cfg: d.cfg, channels: d.channels, at: REGIME_WATCH ? REGIME_WATCH.at : 0 };
    renderRegimeWatch();
    const note = $('#regime-watch-state');
    if (note) {
      const base = note.textContent;
      note.textContent = (enabled ? 'Activado. ' : 'Desactivado. ') + base;
    }
  } catch (e) {
    const note = $('#regime-watch-state');
    if (note) note.textContent = 'No se pudo cambiar: ' + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('#regime-refresh')?.addEventListener('click', () => loadRegime(state.tradeSymbol, true));
$('#reality-run')?.addEventListener('click', () => loadReality(state.tradeSymbol));
document.querySelectorAll('#reality-cost button').forEach(b => b.addEventListener('click', () => {
  RISK.realityCost = Number(b.dataset.cost);
  document.querySelectorAll('#reality-cost button').forEach(x => x.classList.toggle('is-active', x === b));
}));
document.querySelectorAll('#sizing-max button').forEach(b => b.addEventListener('click', () => {
  RISK.sizingMax = Number(b.dataset.max);
  document.querySelectorAll('#sizing-max button').forEach(x => x.classList.toggle('is-active', x === b));
  loadSizing(true);
}));

/* ------------------------------------------------ rentabilidad (TWR) */
let TWR_DAYS = '365';

async function loadTwr(force) {
  const box = $('#twr-body');
  if (!box) return;
  const card = $('#twr-card');
  const keep = anchorTop(card);
  if (!box.querySelector('.twr-item')) box.innerHTML = '<p class="muted tiny" style="padding:12px">Calculando…</p>';
  else box.classList.add('is-loading');
  try {
    const d = await api('/api/twr?days=' + encodeURIComponent(TWR_DAYS) + (force ? '&t=' + Date.now() : ''));
    renderTwr(d);
  } catch (e) {
    box.innerHTML = `<p class="muted tiny" style="padding:12px">${esc(e.message)}</p>`;
  } finally {
    box.classList.remove('is-loading');
    keepAnchor(card, keep);
  }
}

function renderTwr(d) {
  const box = $('#twr-body');
  const sub = $('#twr-sub');
  if (!box) return;
  if (!d || d.ok === false) {
    box.innerHTML = `<p class="muted tiny" style="padding:12px">${esc((d && d.error) || 'Sin datos.')}</p>`;
    if (sub) sub.textContent = 'Sin histórico suficiente todavía.';
    return;
  }
  const cls = v => v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : 'flat';
  const pc = v => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + ' %');
  const desde = new Date(d.from).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  const hasta = new Date(d.to).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  if (sub) sub.textContent = `${desde} → ${hasta} · ${d.days} días · flujo neto ${eur0(d.flows)}`;
  const diffTxt = d.diff == null ? '—' : (d.diff > 0 ? '+' : '') + (d.diff * 100).toFixed(1) + ' pp';
  box.innerHTML = `
    <div class="twr-item"><span>Tu TWR</span><strong class="${cls(d.total)}">${pc(d.total)}</strong><small>${pc(d.annual)} anualizado</small></div>
    <div class="twr-item"><span>Mantener BTC</span><strong class="${cls(d.benchmark == null ? 0 : d.benchmark)}">${pc(d.benchmark)}</strong><small>mismo periodo</small></div>
    <div class="twr-item"><span>Diferencia</span><strong class="${cls(d.diff == null ? 0 : d.diff)}">${diffTxt}</strong><small>${d.diff == null ? 'sin benchmark' : d.diff >= 0 ? 'por delante de BTC' : 'por detrás de BTC'}</small></div>
    <div class="twr-item"><span>Cartera</span><strong>${eur0(d.endValue)}</strong><small>empezó en ${eur0(d.startValue)}</small></div>`;
}

document.querySelectorAll('#twr-range button').forEach(b => b.addEventListener('click', () => {
  TWR_DAYS = b.dataset.days;
  document.querySelectorAll('#twr-range button').forEach(x => x.classList.toggle('is-active', x === b));
  loadTwr(true);
}));

/* ------------------------------------------------ copias automáticas */
async function loadBackups() {
  const box = $('#backups-body');
  if (!box) return;
  try {
    const d = await api('/api/backups');
    renderBackups(d);
  } catch (e) {
    box.innerHTML = `<p class="muted tiny" style="padding:12px">${esc(e.message)}</p>`;
  }
}

function renderBackups(d) {
  const box = $('#backups-body');
  const sub = $('#backups-sub');
  const toggle = $('#backup-auto-toggle');
  if (!box) return;
  if (sub) {
    sub.textContent = d.items.length
      ? `${d.items.length} copia(s) guardadas · se conservan las ${d.cfg.keep} más recientes · una al día`
      : 'Todavía no hay copias. Se creará una al día automáticamente.';
  }
  if (toggle) {
    toggle.classList.toggle('is-active', !!d.cfg.auto);
    toggle.textContent = d.cfg.auto ? 'Automáticas activas' : 'Automáticas';
    toggle.title = d.cfg.auto ? 'Pulsa para desactivar la copia diaria' : 'Pulsa para activar la copia diaria';
  }
  if (!d.items.length) {
    box.innerHTML = '<p class="muted tiny" style="padding:12px">Sin copias todavía. Pulsa «Crear copia ahora» para la primera.</p>';
    return;
  }
  box.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Fecha</th><th class="num">Tamaño</th><th></th></tr></thead>
      <tbody>${d.items.map(it => `<tr>
        <td>${esc(new Date(it.at).toLocaleString('es-ES'))}</td>
        <td class="num">${(it.size / 1024).toFixed(0)} kB</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-xs" type="button" data-restore="${esc(it.file)}">Restaurar</button></td>
      </tr>`).join('')}</tbody></table></div>`;
}

$('#backup-now')?.addEventListener('click', async () => {
  const btn = $('#backup-now');
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/backups', { method: 'POST', body: {} });
    const sub = $('#backups-sub');
    if (sub) sub.textContent = `Copia creada (${(r.size / 1024).toFixed(0)} kB).`;
    await loadBackups();
  } catch (e) {
    toast('No se pudo crear la copia: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('#backup-auto-toggle')?.addEventListener('click', async () => {
  const on = !($('#backup-auto-toggle')?.classList.contains('is-active'));
  try {
    await api('/api/backups/config', { method: 'POST', body: { auto: on } });
    await loadBackups();
    toast(on ? 'Copia automática activada' : 'Copia automática desactivada');
  } catch (e) {
    toast('No se pudo cambiar: ' + e.message);
  }
});

$('#backups-body')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-restore]');
  if (!btn) return;
  const file = btn.dataset.restore;
  const when = new Date(Number(String(file).replace(/^quanto-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/, (m, y, mo, d, h, mi, s) => Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)))).toLocaleString('es-ES');
  if (!confirm(`¿Restaurar la copia del ${when}?\n\nSe sobrescriben los datos actuales. Antes se guarda una copia .bak de cada fichero.`)) return;
  btn.disabled = true;
  try {
    const r = await api('/api/backups/restore', { method: 'POST', body: { file } });
    toast('Restaurado: ' + r.restored.join(', '));
    await loadOverview(true);
    await loadBackups();
  } catch (err) {
    toast('Error al restaurar: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

// El núcleo llama aquí cuando una petición devuelve 401.
setUnauthorized(showLogin);

// Listeners de módulos extraídos.
bindNews();
initPlans({ tradeSymbols });
initAlerts({ coinBadge, renderTelegram });
initRanges({ getWatch: () => WATCH, onRanges: () => { if (state.view === 'coins') renderCoins(); if (state.view === 'dashboard') renderTopCoins(); } });
initCoins({ onSaved: () => { renderDashboard(); if (state.view === 'settings') renderColdList(); } });

/* Puente de la fase 2: el humo de UI navega con window.navigate.
   Desaparece cuando el router esté extraído y las vistas se importen. */
window.navigate = navigate;

/* ------------------------------------------------ informe de coherencia */
let COHERENCE = null;

async function loadCoherence() {
  try {
    const d = await api('/api/coherence');
    COHERENCE = d;
    renderCoherence();
  } catch { /* sin informe disponible */ }
}

function renderCoherence() {
  const toggle = $('#coherence-toggle');
  const sub = $('#coherence-sub');
  if (!toggle || !COHERENCE) return;
  const on = COHERENCE.cfg.enabled !== false;
  toggle.classList.toggle('is-active', on);
  toggle.textContent = on ? 'Semanal activo' : 'Semanal';
  const canales = [];
  if (COHERENCE.channels && COHERENCE.channels.telegram) canales.push('Telegram');
  if (COHERENCE.channels && COHERENCE.channels.email) canales.push('email');
  if (sub) {
    const ultimo = COHERENCE.cfg.lastSentAt ? ` Último envío: ${new Date(COHERENCE.cfg.lastSentAt).toLocaleDateString('es-ES')}.` : '';
    sub.textContent = `Cada lunes a las ${String(COHERENCE.cfg.hour).padStart(2, '0')}:00` +
      (canales.length ? ` por ${canales.join(' y ')}` : ' (sin canal configurado)') + '.' + ultimo;
  }
}

$('#coherence-toggle')?.addEventListener('click', async () => {
  const on = !($('#coherence-toggle')?.classList.contains('is-active'));
  try {
    const d = await api('/api/coherence/config', { method: 'POST', body: { enabled: on } });
    COHERENCE = { ...COHERENCE, cfg: d.cfg };
    renderCoherence();
    toast(on ? 'Informe semanal activado' : 'Informe semanal desactivado');
  } catch (e) { toast('No se pudo cambiar: ' + e.message); }
});

$('#coherence-preview')?.addEventListener('click', async () => {
  const box = $('#coherence-body');
  const btn = $('#coherence-preview');
  if (!box) return;
  if (btn) btn.disabled = true;
  box.hidden = false;
  box.textContent = 'Calculando… (unas llamadas a Bitvavo)';
  try {
    const d = await api('/api/coherence?preview=1');
    box.textContent = d.ok ? d.preview.text : ('No disponible: ' + (d.error || ''));
  } catch (e) {
    box.textContent = 'No disponible: ' + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('#coherence-send')?.addEventListener('click', async () => {
  const btn = $('#coherence-send');
  if (btn) btn.disabled = true;
  try {
    const d = await api('/api/coherence/send', { method: 'POST', body: {} });
    const t = d.results && d.results.telegram === 'ok';
    const e = d.results && d.results.email === 'ok';
    toast(t || e ? 'Enviado por ' + [t && 'Telegram', e && 'email'].filter(Boolean).join(' y ') : 'No hay canal configurado');
    await loadCoherence();
  } catch (err) {
    toast('No se pudo enviar: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});
