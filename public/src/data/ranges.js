'use strict';
// Rangos de precio (máximo del año, ATH/ATL). Se cargan una vez y se cachean.
import { api, state, num, priceFmt } from '../core.js';

export function rangeFmt(v) {
  const a = Math.abs(Number(v) || 0);
  if (!a) return '—';
  if (a < 0.001) return num(v, 6);
  if (a < 1) return num(v, 4);
  if (a < 10) return num(v, 3);
  if (a < 1000) return num(v, 2);
  return priceFmt(v);
}

export let RANGES = {};

// Quién está en seguimiento lo sabe la app; aquí se inyecta.
let getWatch = () => [];
let onRanges = null;
export function initRanges(deps = {}) {
  if (typeof deps.getWatch === 'function') getWatch = deps.getWatch;
  if (typeof deps.onRanges === 'function') onRanges = deps.onRanges;
}

export async function loadRanges() {
  const cartera = ((state.portfolio && state.portfolio.coins) || []).map(c => c.symbol);
  const seguidas = getWatch();
  const syms = [...new Set([...cartera, ...seguidas])].slice(0, 30);
  if (!syms.length) return;
  try {
    const d = await api('/api/ranges?symbols=' + encodeURIComponent(syms.join(',')));
    RANGES = d.ranges || {};
    state.ranges = RANGES;
    if (onRanges) onRanges();
  } catch {}
}
