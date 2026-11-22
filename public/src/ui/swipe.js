'use strict';
import { haptic } from '../core.js';
// Cambio de vista deslizando el dedo a izquierda o derecha (solo en pantallas táctiles).
// Sigue el orden del menú lateral, que respeta el orden personalizado del usuario.

const ANCHO_MAX = 900;      // solo móvil/tableta estrecha
const DISTANCIA_MIN = 70;   // píxeles para considerarlo deslizamiento
const DURACION_MAX = 1500;  // ms (un gesto humano dura mucho menos)
const RATIO = 1.5;          // debe ser claramente horizontal

let activo = false;
let x0 = 0;
let y0 = 0;
let t0 = 0;

/**
 * ¿El gesto cae donde deslizar en horizontal significa otra cosa?
 * Solo se excluye si de verdad hay algo que se desplaza en horizontal (o un control),
 * no por la mera presencia de una tabla.
 */
function bloqueaGestoS(el) {
  let n = el;
  while (n && n !== document.body && n !== document.documentElement) {
    const tag = n.tagName;
    if (tag === 'CANVAS' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (n.hasAttribute && n.hasAttribute('data-noswipe')) return true;
    if (n.scrollWidth > n.clientWidth + 4) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    n = n.parentElement;
  }
  return false;
}

/** Vistas en el orden del menú (incluye las que están en la hoja «Más»). */
function ordenVistas() {
  return [...document.querySelectorAll('.sidebar .nav-item[data-view]')].map(b => b.dataset.view);
}

export function initSwipe({ navigate, getView }) {
  if (typeof navigate !== 'function') return;

  document.addEventListener('touchstart', (e) => {
    activo = false;
    if (e.touches.length !== 1) return;
    if (window.innerWidth > ANCHO_MAX) return;
    const t = e.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (el && bloqueaGestoS(el)) return;
    x0 = t.clientX;
    y0 = t.clientY;
    t0 = Date.now();
    activo = true;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!activo) return;
    activo = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (Date.now() - t0 > DURACION_MAX) return;
    if (Math.abs(dx) < DISTANCIA_MIN) return;
    if (Math.abs(dx) < Math.abs(dy) * RATIO) return;

    const orden = ordenVistas();
    const actual = orden.indexOf(getView());
    if (actual < 0) return;
    const destino = dx < 0 ? orden[actual + 1] : orden[actual - 1];
    if (destino) { haptic(28); navigate(destino); }
  }, { passive: true });

  // Cancelar si el gesto se vuelve vertical (scroll).
  document.addEventListener('touchmove', (e) => {
    if (!activo) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientY - y0) > 40 && Math.abs(t.clientY - y0) > Math.abs(t.clientX - x0)) activo = false;
  }, { passive: true });
}
