'use strict';
/* ============================================================
   Quanto 2.0 — interfaz
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  view: 'dashboard',
  status: null,
  portfolio: null,
  history: { points: [], intervalMin: 5 },
  evolution: null,
  fearGreed: null,
  tax: null,
  taxYear: 'all',
  settings: null,
  transactions: [],
  cold: {},
  overrides: {},
  range: '6M',
  fgRange: '1A',
  opsFilter: 'all',
  opsQuery: '',
  opsLimit: 60,
  coinsQuery: '',
  coinsSort: 'value',
  loading: false,
};

const charts = new Map();

/* ------------------------------------------------ formato */
const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0Fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function eur(v) { return v === null || v === undefined || !isFinite(v) ? '—' : eurFmt.format(v); }
function eur0(v) { return v === null || v === undefined || !isFinite(v) ? '—' : eur0Fmt.format(v); }
function num(v, d = 2) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(v);
}
function pct(v, d = 2) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + num(v, d) + ' %';
}
function priceFmt(v) {
  if (!isFinite(v) || v === null) return '—';
  let d = 2;
  if (v < 0.01) d = 6; else if (v < 1) d = 4; else if (v < 100) d = 3;
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
function short(v) {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' M';
  if (abs >= 1e4) return (v / 1e3).toFixed(1).replace('.', ',') + ' k';
  if (abs >= 1e3) return (v / 1e3).toFixed(2).replace('.', ',') + ' k';
  return num(v, 0);
}
function dateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}
function dateLong(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}
function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function relTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60e3) return 'hace un momento';
  if (diff < 3600e3) return 'hace ' + Math.round(diff / 60e3) + ' min';
  if (diff < 86400e3) return 'hace ' + Math.round(diff / 3600e3) + ' h';
  return 'hace ' + Math.round(diff / 86400e3) + ' días';
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function signed(v) { return v >= 0 ? 'pos' : 'neg'; }
function arrow(v) { return v >= 0 ? '▲' : '▼'; }

/* ------------------------------------------------ peticiones */
async function api(path, options = {}) {
  const opts = { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options };
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('sin sesión');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || ('Error ' + res.status));
  return data;
}

/* ------------------------------------------------ tema y gráficos */
function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue('--text').trim() || '#edf1f8',
    muted: cs.getPropertyValue('--muted').trim() || '#8593a8',
    line: cs.getPropertyValue('--line').trim() || 'rgba(255,255,255,.09)',
    accent: cs.getPropertyValue('--accent').trim() || '#8ba4ff',
    accent2: cs.getPropertyValue('--accent-2').trim() || '#22d3ee',
    pos: cs.getPropertyValue('--pos').trim() || '#34e0a1',
    neg: cs.getPropertyValue('--neg').trim() || '#ff7387',
    text2: cs.getPropertyValue('--text-2').trim() || '#b6c1d4',
  };
}
function hexA(hex, alpha) {
  const h = String(hex || '').trim();
  if (!h.startsWith('#')) return h;
  let c = h.slice(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const n = parseInt(c, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
function chart(id, option) {
  if (typeof echarts === 'undefined') return null;
  const el = document.getElementById(id);
  if (!el) return null;
  let inst = echarts.getInstanceByDom(el);
  if (!inst || inst.isDisposed()) {
    el.innerHTML = '';
    inst = echarts.init(el, null, { renderer: 'canvas' });
    charts.set(id, inst);
  }
  inst.setOption(option, true);
  return inst;
}

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

function baseTooltip(v) {
  return {
    trigger: 'axis',
    backgroundColor: v.tip,
    borderColor: v.line,
    borderWidth: 1,
    padding: [9, 12],
    textStyle: { color: v.text, fontSize: 12 },
    axisPointer: { type: 'line', lineStyle: { color: v.line, width: 1 } },
  };
}

/* ------------------------------------------------ toast */
let toastTimer = null;
function toast(message, isError) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 4200);
}

/* ------------------------------------------------ navegación */
const VIEW_TITLES = {
  dashboard: ['Resumen', 'Tu cartera de un vistazo'],
  coins: ['Monedas', 'Posiciones, precio medio y rentabilidad'],
  market: ['Miedo y codicia', 'El termómetro del mercado cripto'],
  operations: ['Operaciones', 'Todas tus compras, ventas y movimientos'],
  tax: ['Fiscal', 'Informe FIFO listo para la declaración'],
  alerts: ['Alertas', 'Avisos de precio por Telegram'],
  settings: ['Ajustes', 'Claves, historial, seguridad y datos'],
};

function navigate(view) {
  state.view = view;
  $$('.view').forEach(v => v.classList.add('hidden'));
  const target = $('#view-' + view);
  if (target) target.classList.remove('hidden');
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  const [title, sub] = VIEW_TITLES[view] || ['Quanto', ''];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  if (view === 'dashboard') renderDashboard();
  if (view === 'coins') renderCoins();
  if (view === 'tax') loadTax();
  if (view === 'operations') loadTransactions();
  if (view === 'settings') loadSettingsView();
  if (view === 'alerts') renderAlertsView();
  if (view === 'market') renderFearGreed();
  setTimeout(resizeCharts, 60);
  if (location.hash !== '#/' + view) history.replaceState(null, '', '#/' + view);
}

$$('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.goto)));

/* ------------------------------------------------ login */
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  setTimeout(() => { const i = $('#login-pass'); if (i) i.focus(); }, 80);
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-error');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#login-pass').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      err.textContent = data.error || 'Contraseña incorrecta';
      return;
    }
    $('#login-pass').value = '';
    showApp();
    await boot();
  } catch (e2) {
    err.textContent = 'No se pudo conectar con el servidor';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  state.portfolio = null;
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

/* ============================================================
   CARGA DE DATOS
   ============================================================ */
async function boot() {
  showApp();
  await loadCoinIcons();
  await Promise.all([loadOverview(true), loadFearGreed(), loadHistory(), loadSettings(), loadTransactions()]);
  navigate(location.hash.startsWith('#/') ? location.hash.slice(2) : 'dashboard');
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
    state.cold = await api('/api/holdings');
    state.overrides = await api('/api/overrides');
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

  const sideValue = $('#side-value');
  if (sideValue) sideValue.textContent = eur(p.totalValue);
  const sideChange = $('#side-change');
  if (sideChange) {
    sideChange.textContent = `${arrow(p.dayChangeValue || 0)} ${pct(p.dayChangePct)} hoy`;
    sideChange.className = 'side-change ' + signed(p.dayChangeValue || 0);
  }

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
  let points = [];
  let source = '';
  const evo = (state.history.points || []).length > 8 ? null : await loadEvolution();
  if (evo && evo.points && evo.points.length > 4) {
    points = evo.points;
    source = 'reconstruida desde tu historial';
  } else if (state.history.points && state.history.points.length > 1) {
    points = state.history.points;
    source = 'guardada cada ' + (state.history.intervalMin || 5) + ' min';
  }
  const cut = rangeCut(state.range);
  const filtered = points.filter(p => p.t >= cut);
  const el = $('#chart-evolution');
  if (!filtered.length) {
    clearChart('chart-evolution', '<div class="empty">Aún no hay histórico. Importa tu CSV y se reconstruirá la evolución.</div>');
    return;
  }
  if (el && el.querySelector('.empty')) el.innerHTML = '';

  const sub = $('#evo-sub');
  if (sub) sub.textContent = `${filtered.length} puntos · ${source}`;

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

const PIE_COLORS = ['#8ba4ff', '#22d3ee', '#a78bfa', '#34e0a1', '#ffc266', '#ff7387', '#60a5fa', '#f472b6', '#4ade80', '#facc15', '#c084fc', '#2dd4bf'];

function coinColor(symbol) {
  let h = 0;
  for (const ch of String(symbol)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PIE_COLORS[h % PIE_COLORS.length];
}

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
    tooltip: { ...baseTooltip(v), trigger: 'item', formatter: (i) => `${i.name}<br/><b>${eur(i.value)}</b> · ${num(i.percent, 1)} %` },
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

let COIN_ICONS = new Set();
async function loadCoinIcons() {
  try {
    const res = await fetch('/icons/coins/index.json', { cache: 'force-cache' });
    if (res.ok) COIN_ICONS = new Set((await res.json()).map(s => String(s).toLowerCase()));
  } catch { /* sin iconos: se usa la insignia con letras */ }
}

function coinBadge(symbol) {
  const sym = String(symbol || '').toLowerCase();
  if (COIN_ICONS.has(sym)) {
    return `<span class="coin-badge coin-badge-icon"><img src="/icons/coins/${encodeURIComponent(sym)}.png" alt="" loading="lazy" decoding="async"></span>`;
  }
  const c = coinColor(symbol);
  const label = String(symbol).length <= 4 ? String(symbol) : String(symbol).slice(0, 3);
  return `<span class="coin-badge" style="background:linear-gradient(140deg,${c},${hexA(c, .55)})">${esc(label)}</span>`;
}

function coinRow(c, index) {
  const change = c.dayChangePct;
  return `<tr data-symbol="${esc(c.symbol)}" class="clickable">
    <td>
      <div class="coin">${coinBadge(c.symbol)}
        <div class="coin-name"><b>${esc(c.symbol)}</b><small>${c.inCold > 0 ? 'parte en frío' : c.onExchange > 0 ? 'en Bitvavo' : '—'}</small></div>
      </div>
    </td>
    <td class="num">${num(c.amount, 8)}</td>
    <td class="num">${priceFmt(c.price)}</td>
    <td class="num"><b>${eur(c.value)}</b></td>
    <td class="num">${c.costKnown ? priceFmt(c.avgPrice) : '<span class="muted">n/d</span>'}</td>
    <td class="num ${c.pnl === null ? '' : signed(c.pnl)}">${c.pnl === null ? '<span class="muted">n/d</span>' : `<b>${c.pnl >= 0 ? '+' : ''}${eur(c.pnl)}</b><br><small>${pct(c.pnlPct)}</small>`}</td>
    <td class="num ${signed(change || 0)}">${change === null || change === undefined ? '—' : pct(change)}</td>
    <td class="num"><div class="bar" title="${num(c.share, 1)} %"><span style="width:${Math.min(100, c.share)}%"></span></div></td>
    <td class="num"><button class="link" data-open="${esc(c.symbol)}">Detalle</button></td>
  </tr>`;
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
    <thead><tr><th>Moneda</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">P. medio</th><th class="num">Valor</th><th class="num">P/L</th><th class="num">Hoy</th></tr></thead>
    <tbody>${rows.map(c => `<tr data-symbol="${esc(c.symbol)}" class="clickable">
      <td><div class="coin">${coinBadge(c.symbol)}<div class="coin-name"><b>${esc(c.symbol)}</b><small>${num(c.share, 1)} %</small></div></div></td>
      <td class="num">${num(c.amount, 6)}</td>
      <td class="num">${priceFmt(c.price)}</td>
      <td class="num">${c.costKnown ? priceFmt(c.avgPrice) : '<span class="muted">n/d</span>'}</td>
      <td class="num"><b>${eur(c.value)}</b></td>
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
  const points = fg.series.slice(-120);
  chart('chart-fg-mini', {
    animationDuration: 400,
    grid: { left: 0, right: 0, top: 6, bottom: 0 },
    xAxis: { type: 'time', show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, min: 0, max: 100 },
    tooltip: { ...baseTooltip(v), formatter: (i) => `${new Date(i[0].value[0]).toLocaleDateString('es-ES')}<br/><b>${i[0].value[1]}</b>` },
    series: [{
      type: 'line', showSymbol: false, smooth: 0.3, data: points.map(p => [p.t, p.value]),
      lineStyle: { width: 2, color: v.accent2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: hexA(v.accent2, .35) }, { offset: 1, color: hexA(v.accent2, 0) }]) },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: v.muted, type: [3, 3], width: 1, opacity: .5 },
        data: [{ yAxis: 50 }],
        label: { show: false },
      },
    }],
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
      lineStyle: { width: 1.8, color: v.text2 },
      areaStyle: { color: hexA(v.accent, .12) },
      markArea: {
        silent: true,
        data: bands.map(b => [{ yAxis: b[0], itemStyle: { color: hexA(b[2], .10) } }, { yAxis: b[1] }]),
        label: { show: false },
      },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: v.muted, type: [3, 3], opacity: .6 }, label: { show: false }, data: [{ yAxis: 50 }] },
    }],
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

/* ============================================================
   MONEDAS
   ============================================================ */
function filteredCoins() {
  const p = state.portfolio;
  if (!p) return [];
  let rows = p.coins.slice();
  const q = state.coinsQuery.trim().toLowerCase();
  if (q) rows = rows.filter(c => c.symbol.toLowerCase().includes(q));
  const sort = state.coinsSort;
  rows.sort((a, b) => {
    if (sort === 'name') return a.symbol.localeCompare(b.symbol);
    if (sort === 'pnl') return (b.pnl || -Infinity) - (a.pnl || -Infinity);
    if (sort === 'pnlpct') return (b.pnlPct || -Infinity) - (a.pnlPct || -Infinity);
    if (sort === 'day') return (b.dayChangePct || 0) - (a.dayChangePct || 0);
    return b.value - a.value;
  });
  return rows;
}

function renderCoins() {
  const rows = filteredCoins();
  const tbody = $('#coins-tbody');
  const empty = $('#coins-empty');
  if (!tbody) return;
  $('#coins-count').textContent = `${rows.length} ${rows.length === 1 ? 'moneda' : 'monedas'}`;
  if (!rows.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = rows.map(c => coinRow(c)).join('');
  tbody.querySelectorAll('tr[data-symbol]').forEach(tr => tr.addEventListener('click', () => openCoin(tr.dataset.symbol)));
}

$('#coins-search')?.addEventListener('input', (e) => { state.coinsQuery = e.target.value; renderCoins(); });
$('#coins-sort')?.addEventListener('change', (e) => { state.coinsSort = e.target.value; renderCoins(); });

function openCoin(symbol) {
  const p = state.portfolio;
  const coin = p && p.coins.find(c => c.symbol === symbol);
  if (!coin) return;
  const rows = state.transactions.filter(t => t.symbol === symbol).slice(0, 6);
  $('#modal-title').textContent = symbol + ' · EUR';
  $('#modal-body').innerHTML = `
    <div class="modal-grid">
      <div class="stat"><span>Cantidad</span><strong>${num(coin.amount, 8)}</strong></div>
      <div class="stat"><span>Valor actual</span><strong>${eur(coin.value)}</strong></div>
      <div class="stat"><span>Precio</span><strong>${priceFmt(coin.price)}</strong></div>
      <div class="stat"><span>Precio medio</span><strong>${coin.avgPrice ? priceFmt(coin.avgPrice) : 'n/d'}</strong></div>
      <div class="stat"><span>Invertido</span><strong>${coin.invested !== null ? eur(coin.invested) : 'n/d'}</strong></div>
      <div class="stat"><span>P/L</span><strong class="${coin.pnl === null ? '' : signed(coin.pnl)}">${coin.pnl === null ? 'n/d' : (coin.pnl >= 0 ? '+' : '') + eur(coin.pnl)} ${coin.pnlPct !== null ? '(' + pct(coin.pnlPct) + ')' : ''}</strong></div>
      <div class="stat"><span>En Bitvavo</span><strong>${num(coin.onExchange, 8)}</strong></div>
      <div class="stat"><span>En wallet fría</span><strong>${num(coin.inCold, 8)}</strong></div>
    </div>
    <div id="coin-chart" class="chart" style="height:220px"></div>
    <div class="modal-grid" style="grid-template-columns:1fr 1fr">
      <form class="field" id="coin-invested-form">
        <span>Invertido total (€)</span>
        <input id="coin-invested" type="number" step="any" min="0" placeholder="Automático" value="${coin.invested !== null ? coin.invested : ''}">
      </form>
      <form class="field" id="coin-cold-form">
        <span>Cantidad en wallet fría</span>
        <input id="coin-cold" type="number" step="any" min="0" placeholder="0" value="${coin.inCold || ''}">
      </form>
    </div>
    ${rows.length ? `<h3 class="h3" style="margin-top:16px">Últimas operaciones</h3>
      <table class="table"><tbody>${rows.map(t => `<tr><td>${dateShort(t.ts)}</td><td><span class="pill ${t.type}">${esc(t.label)}</span></td><td class="num">${num(t.amount, 6)}</td><td class="num">${t.price ? priceFmt(t.price) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
  `;
  $('#modal-foot').innerHTML = `
    <button class="btn btn-ghost" data-close="1">Cerrar</button>
    <button class="btn btn-primary" id="coin-save">Guardar cambios</button>`;
  $('#modal-foot').querySelector('[data-close]').addEventListener('click', closeModal);
  $('#coin-save').addEventListener('click', async () => {
    try {
      const invested = $('#coin-invested').value;
      const cold = $('#coin-cold').value;
      if (invested !== '') await api('/api/overrides', { method: 'POST', body: JSON.stringify({ symbol, invested }) });
      else await api('/api/overrides', { method: 'POST', body: JSON.stringify({ symbol, invested: null }) });
      if (cold !== '') await api('/api/holdings', { method: 'POST', body: JSON.stringify({ symbol, amount: Number(cold), invested: invested === '' ? null : Number(invested) }) });
      closeModal();
      toast('Guardado');
      state.portfolio = (await api('/api/portfolio?force=1'));
      state.cold = await api('/api/holdings');
      state.overrides = await api('/api/overrides');
      renderDashboard();
      if (state.view === 'coins') renderCoins();
      if (state.view === 'settings') renderColdList();
    } catch (e) { toast(e.message, true); }
  });
  openModal();
  loadCoinChart(symbol);
}

async function loadCoinChart(symbol) {
  try {
    const data = await api('/api/candles?symbol=' + encodeURIComponent(symbol) + '&interval=1d&limit=180');
    const pts = (data.points || []).slice().sort((a, b) => a.t - b.t);
    if (!pts.length) return;
    const v = themeVars();
    chart('coin-chart', {
      animationDuration: 400,
      grid: { left: 4, right: 10, top: 10, bottom: 4, containLabel: true },
      tooltip: {
        ...baseTooltip(v),
        formatter: (items) => {
          const it = items[0];
          const d = pts[it.dataIndex];
          if (!d) return '';
          const up = d.close >= d.open;
          return `${new Date(d.t).toLocaleDateString('es-ES')}<br/>A ${priceFmt(d.open)} · C ${priceFmt(d.close)}<br/><span style="color:${up ? v.pos : v.neg}">${up ? '▲' : '▼'} ${pct(((d.close - d.open) / d.open) * 100)}</span>`;
        },
      },
      xAxis: { type: 'category', data: pts.map(p => new Date(p.t).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: v.muted, fontSize: 10, interval: Math.floor(pts.length / 6) } },
      yAxis: { type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: v.muted, fontSize: 10, formatter: (x) => short(x) }, splitLine: { lineStyle: { color: v.line, type: [4, 4] } } },
      series: [{
        type: 'candlestick',
        data: pts.map(p => [p.open, p.close, p.low, p.high]),
        itemStyle: { color: v.pos, color0: v.neg, borderColor: v.pos, borderColor0: v.neg },
      }],
    });
  } catch {}
}

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
  </tr>`).join('') || '<tr><td colspan="5" class="empty">Sin inventario</td></tr>';

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
      ${r.unmatched > 0 ? `<div class="row"><span class="warn">Sin compra registrada</span><b class="warn">${num(r.unmatched, 8)} ${esc(symbol)}</b></div>` : ''}`;
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
  if (next.length < 8) { out.className = 'result err'; out.textContent = 'La nueva contraseña necesita 8 caracteres o más.'; return; }
  if (next !== $('#pass-repeat').value) { out.className = 'result err'; out.textContent = 'Las contraseñas no coinciden.'; return; }
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ password: next, currentPassword: $('#pass-current').value }) });
    out.className = 'result ok';
    out.textContent = 'Contraseña cambiada. Vuelve a entrar con ella.';
    $('#pas-current');
    setTimeout(() => location.reload(), 1400);
  } catch (e2) { out.className = 'result err'; out.textContent = e2.message; }
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
function openModal() { $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
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

/* ------------------------------------------------ alertas */
async function renderAlertsView() {
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
    const gapPct = price ? ((r.price - price) / price) * 100 : null;
    const estado = r.lastError ? 'error' : (r.armed === false ? 'disparada' : 'armada');
    const chipCls = r.lastError ? ' chip-err' : (r.armed === false ? ' chip-warn' : ' chip-ok');
    return `<div class="alert-row ${r.enabled === false ? 'is-off' : ''}">
      <div class="alert-main">
        <b>${esc(r.symbol)}</b>
        <small>${r.op === 'above' ? 'por encima de' : 'por debajo de'} ${priceFmt(r.price)}</small>
      </div>
      <div class="alert-price">
        <span>${price === null ? '—' : priceFmt(price)}</span>
        <small>${gapPct === null ? '' : (gapPct >= 0 ? 'faltan ' : 'pasado por ') + num(Math.abs(gapPct), 1) + ' %'}</small>
      </div>
      <span class="chip${chipCls}">${estado}</span>
      <div class="alert-actions">
        <button class="link" data-alert-toggle="${esc(r.id)}">${r.enabled === false ? 'Activar' : 'Pausar'}</button>
        <button class="link" data-alert-del="${esc(r.id)}">Borrar</button>
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

$('#alert-symbol')?.addEventListener('change', updateAlertHint);
$('#alert-op')?.addEventListener('change', updateAlertHint);

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

$('#alert-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#alert-result');
  try {
    const symbol = $('#alert-symbol').value;
    const op = ($('#alert-op') || {}).value === 'above' ? 'above' : 'below';
    const price = Number(String($('#alert-price').value).replace(',', '.'));
    await api('/api/alerts', { method: 'POST', body: JSON.stringify({ symbol, price, op }) });
    if (out) {
      out.className = 'result ok';
      const coin = ((state.portfolio && state.portfolio.coins) || []).find(c => c.symbol === symbol);
      const already = coin && (op === 'below' ? coin.price <= price : coin.price >= price);
      out.textContent = `Alerta creada: ${symbol} ${op === 'above' ? 'por encima' : 'por debajo'} de ${priceFmt(price)}.`
        + (already ? ' Ojo: ya cumple la condición ahora mismo, se disparará en la próxima comprobación.' : '');
    }
    $('#alert-price').value = '';
    await refreshAlertsList();
    toast('Alerta creada');
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
    out.innerHTML = `<div class="alert-preview">${esc(r.text)}</div>`;
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
  try {
    if (del) {
      await api('/api/alerts/' + del.dataset.alertDel, { method: 'DELETE' });
      await refreshAlertsList();
      toast('Alerta borrada');
    } else if (toggle) {
      await api('/api/alerts/' + toggle.dataset.alertToggle + '/toggle', { method: 'POST', body: '{}' });
      await refreshAlertsList();
    }
  } catch (err) { toast(err.message, true); }
});

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

(async function start() {
  try { const saved = localStorage.getItem('quanto-theme'); if (saved) document.documentElement.dataset.theme = saved; } catch {}
  try {
    const status = await (await fetch('/api/status')).json();
    if (!status.hasPassword) { $('#login-error').textContent = 'Sin contraseña configurada: revisa el log del contenedor.'; }
    const probe = await fetch('/api/session', { credentials: 'same-origin' });
    if (probe.ok) {
      showApp();
      await boot();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
