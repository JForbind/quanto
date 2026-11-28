/* Arranque del panel lateral: aplica ancho y plegado antes del primer pintado.
   Va como fichero externo porque la CSP solo permite scripts propios ('self'). */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('quanto.sidebar') || '{}');
    if (s.w) document.documentElement.style.setProperty('--sidebar-w', s.w + 'px');
    if (s.collapsed) document.documentElement.setAttribute('data-sidebar', 'collapsed');
  } catch (e) { /* sin preferencias guardadas */ }
})();
