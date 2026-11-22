'use strict';
// Vista de Monedas: tabla, buscador, orden y ficha de cada moneda.
import { $, state, api, toast, eur, num, pct, priceFmt, signed, dateShort, esc } from '../core.js';
import { coinRow } from '../ui/coins.js';
import { chart, themeVars, baseTooltip } from '../ui/charts.js';
import { openModal, closeModal } from '../ui/modal.js';
import { RANGES, rangeFmt } from '../data/ranges.js';

let onSaved = null;

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

export function renderCoins() {
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

export function initCoins(deps = {}) {
  if (typeof deps.onSaved === 'function') onSaved = deps.onSaved;
  $('#coins-search')?.addEventListener('input', (e) => { state.coinsQuery = e.target.value; renderCoins(); });
  $('#coins-sort')?.addEventListener('change', (e) => { state.coinsSort = e.target.value; renderCoins(); });
}

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
    ${(() => {
      const r = RANGES[symbol] || {};
      if (!r.high && !r.ath) return '';
      const f = (v) => (v ? rangeFmt(v) : '—');
      const fecha = (ts) => ts ? new Date(ts).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }) : '';
      return `<h3 class="h3" style="margin-top:16px">Rangos de precio</h3>
      <div class="rng-grid">
        <div class="stat"><span>${r.athApprox && r.athFrom ? 'Máximo desde ' + new Date(r.athFrom).getFullYear() : 'Máximo histórico'}</span><strong>${f(r.ath)}</strong><small>${r.athApprox && r.athFrom ? 'sin histórico completo' : fecha(r.athDate)}</small></div>
        <div class="stat"><span>Máximo ${r.year || ''}</span><strong>${f(r.high)}</strong><small>año en curso</small></div>
        <div class="stat"><span>Mínimo ${r.year || ''}</span><strong>${f(r.low)}</strong><small>año en curso</small></div>
      </div>
      ${r.high && r.low && r.high > r.low ? `<div class="rng-bar" title="Dónde está el precio dentro del rango del año">
        <span style="left:${Math.max(0, Math.min(100, ((coin.price - r.low) / (r.high - r.low)) * 100))}%"></span>
      </div>
      <p class="tiny muted" style="margin:6px 0 0">La marca señala el precio actual dentro del rango de ${r.year || 'este año'}.</p>` : ''}`;
    })()}
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
      if (onSaved) onSaved();
    } catch (e) { toast(e.message, true); }
  });
  openModal();
  loadCoinChart(symbol);
}

async function loadCoinChart(symbol) {
  try {
    const data = await api('/api/candles?symbol=' + encodeURIComponent(symbol) + '&interval=1d&limit=180');
    // La API puede devolver velas en bruto ([ts, open, high, low, close, vol]) o puntos ya normalizados.
    const raw = Array.isArray(data.points) && data.points.length
      ? data.points
      : (data.candles || []).map(c => ({ t: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
    const pts = raw.slice().sort((a, b) => a.t - b.t);
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
      yAxis: { type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: v.muted, fontSize: 10, formatter: (x) => priceFmt(x) }, splitLine: { lineStyle: { color: v.line, type: [4, 4] } } },
      series: [{
        type: 'candlestick',
        data: pts.map(p => [p.open, p.close, p.low, p.high]),
        itemStyle: { color: v.pos, color0: v.neg, borderColor: v.pos, borderColor0: v.neg },
      }],
    });
  } catch {}
}
