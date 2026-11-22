'use strict';
// Núcleo compartido del front: selección, estado, formato y peticiones.
// Es lo primero que se extrae para poder ir convirtiendo vistas en módulos.

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export const state = {
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
  sparklines: {},
  me: null,
  tradeSymbol: null,
  tradeInterval: '1h',
  tradeInd: { ma: true, fib: true, boll: false, rsi: false, macd: false },
  wolfe: { mode: 'off', pts: [] },
  loading: false,
};

export const charts = new Map();

/* ------------------------------------------------ formato */
export const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur0Fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// Formato español con agrupación desde 4 cifras (el Intl de es-ES no agrupa 4 dígitos)
export function groupNum(v, d = 2, minD = 0) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const neg = Number(v) < 0;
  const fixed = Math.abs(Number(v)).toFixed(d);
  const [en, fr] = fixed.split('.');
  const ent = en.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = fr && fr.replace(/0+$/, '').length >= minD ? fr.replace(/0+$/, '') : (minD > 0 ? fr : '');
  return (neg ? '-' : '') + ent + (frac ? ',' + frac : '');
}
export function eur(v) { return v === null || v === undefined || !isFinite(v) ? '—' : groupNum(v, 2, 2) + ' €'; }
export function eur0(v) { return v === null || v === undefined || !isFinite(v) ? '—' : groupNum(v, 0) + ' €'; }
export function num(v, d = 2) { return groupNum(v, d); }
export function pct(v, d = 2) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + num(v, d) + ' %';
}
export function priceFmt(v) {
  if (!isFinite(v) || v === null) return '—';
  let d = 2;
  if (v < 0.01) d = 6; else if (v < 1) d = 4; else if (v < 100) d = 3;
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
export function short(v) {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' M';
  if (abs >= 1e4) return (v / 1e3).toFixed(1).replace('.', ',') + ' k';
  if (abs >= 1e3) return (v / 1e3).toFixed(2).replace('.', ',') + ' k';
  return num(v, 0);
}
export function dateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}
export function dateLong(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}
export function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function relTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60e3) return 'hace un momento';
  if (diff < 3600e3) return 'hace ' + Math.round(diff / 60e3) + ' min';
  if (diff < 86400e3) return 'hace ' + Math.round(diff / 3600e3) + ' h';
  return 'hace ' + Math.round(diff / 86400e3) + ' días';
}
export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function signed(v) { return v >= 0 ? 'pos' : 'neg'; }
export function arrow(v) { return v >= 0 ? '▲' : '▼'; }

/* ------------------------------------------------ peticiones */
// El 401 lo resuelve la aplicación; core no sabe de pantallas de login.
let onUnauthorized = null;
export function setUnauthorized(fn) { onUnauthorized = fn; }

export async function api(path, options = {}) {
  const opts = { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(path, opts);
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Error('sin sesión');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || ('Error ' + res.status));
  return data;
}

/* ------------------------------------------------ avisos en pantalla */
let toastTimer = null;
/**
 * Vibración corta en móvil. En la app Android se usa el puente nativo (no depende
 * del permiso del WebView ni de navigator.vibrate); en el navegador, la API web.
 */
export function haptic(ms = 20) {
  try {
    if (typeof window !== 'undefined' && window.QuantoNative && typeof window.QuantoNative.vibrar === 'function') {
      window.QuantoNative.vibrar(ms);
      return true;
    }
  } catch {}
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') return !!navigator.vibrate(ms);
  } catch {}
  return false;
}

/** Diagnóstico para Ajustes: qué mecanismo hay disponible. */
export function hapticEstado() {
  const nativo = !!(typeof window !== 'undefined' && window.QuantoNative && window.QuantoNative.vibrar);
  const web = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return { nativo, web, app: /QuantoApp\//.test(navigator.userAgent) };
}

export function toast(message, isError) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 4200);
}
