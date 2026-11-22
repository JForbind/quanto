'use strict';
// Vista de Noticias: titulares por RSS (ya traducidos en el servidor).
import { $, esc, api, state } from '../core.js';

let NEWS = [];
let newsFilter = 'mine';
let newsRetry = null;

function timeAgo(ts) {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return 'hace ' + m + ' min';
  const h = Math.round(m / 60);
  if (h < 24) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' d';
}

function renderNewsMini(list) {
  const box = $('#news-mini');
  if (!box) return;
  if (!list.length) { box.innerHTML = '<p class="muted tiny">Sin noticias ahora mismo.</p>'; return; }
  box.innerHTML = list.slice(0, 4).map(n => `
    <a class="news-item" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"${n.titleEn ? ` title="${esc(n.titleEn)}"` : ''}>
      <span class="news-meta">${esc(n.source)} · ${timeAgo(n.ts)}</span>
      <span class="news-title">${esc(n.title)}</span>
    </a>`).join('');
}

function renderNewsList() {
  const box = $('#news-list');
  if (!box) return;
  const list = newsFilter === 'mine' ? NEWS.filter(n => n.coins.length || n.macro) : NEWS;
  const sub = $('#news-sub');
  if (sub) sub.textContent = `${list.length} noticias · ${newsFilter === 'mine' ? 'relacionadas con tus monedas' : 'de todas las fuentes'}`;
  if (!list.length) { box.innerHTML = '<p class="muted">Sin noticias.</p>'; return; }
  const enTag = n => (n.lang && n.lang !== 'es' && !n.translated) ? ' · EN' : '';
  box.innerHTML = list.map(n => `
    <a class="news-item" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"${n.titleEn ? ` title="${esc(n.titleEn)}"` : ''}>
      <span class="news-meta">${esc(n.source)} · ${timeAgo(n.ts)}${enTag(n)}${n.coins.length ? ' · ' + n.coins.map(c => esc(c)).join(', ') : ''}</span>
      <span class="news-title">${esc(n.title)}</span>
      ${n.summary ? `<span class="news-sum">${esc(n.summary)}</span>` : ''}
    </a>`).join('');
}

/** Carga los titulares y repinta. Reintenta una vez si quedan traducciones pendientes. */
export async function loadNews(force, isRetry) {
  try {
    const coins = ((state.portfolio && state.portfolio.coins) || []).map(c => c.symbol).slice(0, 40);
    const d = await api('/api/news?coins=' + encodeURIComponent(coins.join(',')) + (force ? '&t=' + Date.now() : ''));
    NEWS = d.items || [];
    renderNewsMini(newsFilter === 'mine' ? NEWS.filter(n => n.coins.length || n.macro) : NEWS);
    const mc = $('#news-mini-sub');
    if (mc) mc.textContent = NEWS.length ? `${NEWS.length} titulares · ${new Date(d.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Sin noticias';
    renderNewsList();
    // Los titulares ingleses se traducen en segundo plano: si aún faltan, reintentar una vez.
    if (d.pending > 0 && !isRetry) {
      clearTimeout(newsRetry);
      newsRetry = setTimeout(() => loadNews(true, true), 8000);
    }
  } catch (e) {
    const mc = $('#news-mini-sub');
    if (mc) mc.textContent = 'No disponible: ' + e.message;
  }
}

/** Listeners de las pestañas «Mis monedas / Todo». */
export function bindNews() {
  document.querySelectorAll('[data-news]').forEach(b => b.addEventListener('click', () => {
    newsFilter = b.dataset.news;
    document.querySelectorAll('[data-news]').forEach(x => x.classList.toggle('is-active', x === b));
    renderNewsList();
    renderNewsMini(newsFilter === 'mine' ? NEWS.filter(n => n.coins.length || n.macro) : NEWS);
  }));
}
