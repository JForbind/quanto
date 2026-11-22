'use strict';
// Gráficos ECharts: tema, tooltips y creación de instancias.
import { charts } from '../core.js';

export function themeVars() {
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

export function hexA(hex, alpha) {
  const h = String(hex || '').trim();
  if (!h.startsWith('#')) return h;
  let c = h.slice(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const n = parseInt(c, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function baseTooltip(v) {
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

export function chart(id, option) {
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
