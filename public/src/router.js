'use strict';
// Router de vistas: muestra la sección, ajusta el menú y llama a la entrada de la vista.
// Sustituye a la cadena de `if (view === 'x')` que vivía en app.js.
import { $, $$, state } from './core.js';

const entradas = new Map();
let titulos = {};
let sharedKpis = null;
let alRedimensionar = null;

export function initRouter({ titles = {}, sharedKpis: kpis = null, resize = null } = {}) {
  titulos = titles;
  sharedKpis = kpis;
  alRedimensionar = resize;
}

/** Registra qué hacer al entrar en una vista (carga de datos, pintado…). */
export function register(view, enter) {
  if (typeof enter === 'function') entradas.set(view, enter);
}

export function navigate(view) {
  state.view = view;
  $$('.view').forEach(v => v.classList.add('hidden'));
  const target = $('#view-' + view);
  if (target) target.classList.remove('hidden');
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));

  if (sharedKpis) sharedKpis(state.portfolio);

  const moreBtn = document.getElementById('more-btn');
  if (moreBtn) moreBtn.classList.toggle('is-active', ['operations', 'tax', 'plans', 'trade', 'sim', 'settings'].includes(view));
  const settingsBtn = $('#settings-btn');
  if (settingsBtn) settingsBtn.classList.toggle('is-active', view === 'settings');

  const [title, sub] = titulos[view] || ['Quanto', ''];
  const t = $('#page-title');
  const s = $('#page-sub');
  if (t) t.textContent = title;
  if (s) s.textContent = sub;

  const topText = document.querySelector('.topbar-text');
  if (topText) {
    topText.classList.remove('is-entering');
    void topText.offsetWidth;
    topText.classList.add('is-entering');
  }

  const enter = entradas.get(view);
  if (enter) {
    try { enter(); } catch (e) { console.error('[router] ' + view + ':', e.message); }
  }

  if (alRedimensionar) setTimeout(alRedimensionar, 60);
  if (location.hash !== '#/' + view) history.replaceState(null, '', '#/' + view);
}

/** Títulos de la vista actual (para el «actualizado hace…»). */
export function viewTitle(view = state.view) {
  return titulos[view] || ['Quanto', ''];
}
