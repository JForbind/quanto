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
import { renderOperations, initOperations } from './src/views/operations.js';
import { loadTax } from './src/views/tax.js';
import { loadLiquidity, loadLeverage, loadPulse, loadCalendar, renderFearGreed } from './src/views/market.js';
import { simState, renderSim, simNumbers, simCoinObject, simSaved, simSave, renderSimSaved, renderSimBuy, initSim } from './src/views/sim.js';
import { loadAppearance } from './src/views/appearance.js';
import { loadSettingsView, renderImportStatus, renderColdList, renderTelegram, initSettings } from './src/views/settings.js';
import { renderDashboard, renderSharedKpis, rangeCut, renderEvolutionChart, renderAllocation, loadRadar, sparklineWide, initDashboard } from './src/views/dashboard.js';
import { themeVars, hexA, baseTooltip, chart, clearChart } from './src/ui/charts.js';
import { openModal, closeModal } from './src/ui/modal.js';
import { RANGES, loadRanges, rangeFmt, initRanges } from './src/data/ranges.js';
import { PIE_COLORS, coinColor, loadCoinIcons, coinBadge, sparklineSvg, rngBlock } from './src/ui/coins.js';
import { loadNews, bindNews } from './src/views/news.js';
import { navigate, register, initRouter } from './src/router.js';
import { loadTradeChart, tradeSymbols, initTrade } from './src/views/trade.js';
import { loadTotp } from './src/views/totp.js';

/* ------------------------------------------------ tema y gráficos */




/** Vacía un gráfico (mensaje de "sin datos") liberando antes la instancia. */

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

// Router: una entrada por vista. El orden da igual; cada una se ejecuta al entrar.
initRouter({ titles: VIEW_TITLES, sharedKpis: renderSharedKpis, resize: resizeCharts });
register('dashboard', () => { renderDashboard(); watchRender(); loadSizing(); loadTwr(); });
register('coins', () => renderCoins());
register('market', () => { loadLiquidity(); loadLeverage(); loadPulse(); loadCalendar(); renderFearGreed(); });
register('news', () => loadNews());
register('sim', () => {
  renderSim();
  if (!Object.keys(RANGES).length) {
    loadRanges().then(() => { if (state.view === 'sim') renderSim(); }).catch(() => {});
  }
});
register('settings', () => { loadTotp(); loadBackups(); loadCoherence(); loadSettingsView(); });
register('alerts', () => { loadAutoAlerts(); renderAlertsView(); });
register('trade', () => loadTradeChart());
register('plans', () => renderPlansView());
register('tax', () => loadTax());
register('operations', () => loadTransactions());

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

    // La hoja «Más» debe dar acceso a TODO lo que no cabe en la barra:
    // antes, las vistas del sidebar fuera del dock (p. ej. Índices) no eran
    // alcanzables en el móvil.
    const hoja = document.getElementById('more-sheet');
    if (hoja) {
      const yaEnHoja = new Set([...hoja.querySelectorAll('[data-view]')].map(b => b.dataset.view));
      ordenFinal.forEach(v => {
        if (cuatro.includes(v) || yaEnHoja.has(v)) return;
        const src = porVista.get(v);
        if (!src) return;
        const clon = src.cloneNode(true);
        clon.classList.remove('is-active');
        clon.classList.add('more-item');
        clon.draggable = false;
        clon.addEventListener('click', () => { if (clon.dataset.view) navigate(clon.dataset.view); });
        hoja.appendChild(clon);
        yaEnHoja.add(v);
      });
    }
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

// El doble factor vive en src/views/totp.js

// Ticket temporal entre la contraseña y el código de 2FA.
let pending2fa = null;

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
;





let PULSE = null;



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

// Simulador vive en src/views/sim.js

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

// Resumen vive en src/views/dashboard.js (parte de datos y gráficos)

// Trading vive en src/views/trade.js

/* ------------------------------------------------ miedo y codicia */
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



// Mercado vive en src/views/market.js


// Monedas vive en src/views/coins.js

// Operaciones vive en src/views/operations.js

// Fiscal vive en src/views/tax.js

// Ajustes vive en src/views/settings.js

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

// Apariencia vive en src/views/appearance.js

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
// Ya no se expone navigate en window: el router vive en su módulo.

// Listeners de módulos extraídos.
bindNews();
initPlans({ tradeSymbols });
initAlerts({ coinBadge, renderTelegram });
initRanges({ getWatch: () => WATCH, onRanges: () => { if (state.view === 'coins') renderCoins(); if (state.view === 'dashboard') renderTopCoins(); } });
initCoins({ onSaved: () => { renderDashboard(); if (state.view === 'settings') renderColdList(); } });
initTrade({ getWatch: () => WATCH, loadRegime, loadRegimeWatch });
initOperations();
initDashboard({ renderTopCoins, renderFearGreedMini });
initSettings({ loadOverview, loadTransactions, boot });
initSim({ getWatch: () => WATCH, getMercados: () => MERCADOS });

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
