'use strict';
// Resumen: KPIs compartidos, evolución, reparto, radar y sparklines.
import { $, $$, state, api, esc, eur, eur0, num, pct, priceFmt, short, signed, dateShort, dateLong } from '../core.js';
import { chart, themeVars, baseTooltip, hexA } from '../ui/charts.js';
import { coinBadge, PIE_COLORS } from '../ui/coins.js';

/* KPIs compartidos: misma fila de resumen en las pestañas de contenido */
export function renderSharedKpis(p) {
  if (!p) return;
  document.querySelectorAll('[data-kpis]').forEach(box => {
    const set = (k, html, cls) => {
      const el = box.querySelector('[data-k="' + k + '"]');
      if (!el) return;
      el.innerHTML = html;
      if (cls !== undefined) el.className = cls;
    };
    set('value', eur(p.totalValue));
    set('value-sub', `<span>${eur(p.cryptoValue)} en cripto</span>${p.cash ? `<span class="dot-sep">·</span><span>${eur(p.cash)} en efectivo</span>` : ''}`);
    set('invested', eur(p.invested));
    set('invested-sub', `<span>${p.coinCount} ${p.coinCount === 1 ? 'moneda' : 'monedas'}</span>`);
    set('pnl', (p.pnl >= 0 ? '+' : '') + eur(p.pnl), 'kpi-value ' + signed(p.pnl));
    set('pnl-sub', `<span class="${signed(p.pnl)}">${arrow(p.pnl)} ${pct(p.pnlPct)}</span><span>sobre lo invertido</span>`);
    set('today', (p.dayChangeValue >= 0 ? '+' : '') + eur(p.dayChangeValue), 'kpi-value ' + signed(p.dayChangeValue || 0));
    set('today-sub', `<span class="${signed(p.dayChangeValue || 0)}">${arrow(p.dayChangeValue || 0)} ${pct(p.dayChangePct)}</span><span>últimas 24 h</span>`);
  });
}

export function renderDashboard() {
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

  renderSharedKpis(p);

  renderEvolutionChart();
  renderAllocation();
  renderTopCoins();
  renderFearGreedMini();
}

export function rangeCut(range) {
  const now = Date.now();
  const day = 86400e3;
  if (range === '1M') return now - 30 * day;
  if (range === '3M') return now - 90 * day;
  if (range === '6M') return now - 182 * day;
  if (range === '1A') return now - 365 * day;
  return 0;
}

export async function renderEvolutionChart() {
  const v = themeVars();
  const hist = (state.history.points || []).slice();
  const evo = await loadEvolution();

  let points = [];
  let source = '';
  if (evo && Array.isArray(evo.points) && evo.points.length > 4) {
    // Serie reconstruida desde el historial importado (cubre desde la primera compra).
    points = evo.points.map(p => ({ t: p.t, value: p.value, invested: p.invested }));
    source = 'reconstruida desde tu historial';
    // Enlazamos con las capturas de hoy posteriores al último punto de la serie.
    if (hist.length) {
      const lastT = points.length ? points[points.length - 1].t : 0;
      const extra = hist.filter(p => p.t > lastT).map(p => ({ t: p.t, value: p.value, invested: p.invested }));
      if (extra.length) points = points.concat(extra);
    }
  } else if (hist.length > 1) {
    points = hist;
    source = 'guardada cada ' + (state.history.intervalMin || 5) + ' min';
  }

  const cut = rangeCut(state.range);
  let filtered = points.filter(p => p.t >= cut);
  // Si el rango elegido deja menos de 2 puntos, mostramos toda la serie en vez de un vacío.
  if (filtered.length < 2 && points.length >= 2) filtered = points;
  const el = $('#chart-evolution');
  if (!filtered.length) {
    clearChart('chart-evolution', '<div class="empty">Aún no hay histórico. Importa tu CSV y se reconstruirá la evolución.</div>');
    return;
  }
  if (el && el.querySelector('.empty')) el.innerHTML = '';

  const sub = $('#evo-sub');
  if (sub) {
    const desde = new Date(filtered[0].t).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    sub.textContent = `${filtered.length} puntos · desde ${desde} · ${source}`;
  }

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




export function renderAllocation() {
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
    tooltip: {
      ...baseTooltip(v), trigger: 'item',
      backgroundColor: 'rgba(8,12,20,.95)',
      borderWidth: 0,
      padding: [8, 10],
      extraCssText: 'box-shadow:0 12px 30px -14px rgba(0,0,0,.9); border-radius:10px;',
      formatter: (i) => {
        const c = typeof i.color === 'string' ? i.color : '#7c8aa5';
        return `<div style="min-width:118px;border-left:3px solid ${c};padding-left:9px">
          <div style="font-weight:650;color:${c};font-size:12.5px">${i.name}</div>
          <div style="margin-top:2px;color:#e8eefc">${eur(i.value)} · ${num(i.percent, 1)} %</div>
        </div>`;
      },
    },
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



/* Radar del mercado: mayores subidas y bajadas del día */
export function radarRow(item, up) {
  const pct = (item.change >= 0 ? '+' : '') + num(item.change, 2) + ' %';
  return `<div class="radar-row">
    ${coinBadge(item.symbol)}
    <b>${esc(item.symbol)}</b>
    <span class="radar-price">${priceFmt(item.price)}</span>
    <span class="radar-pct ${up ? 'pos' : 'neg'}">${pct}</span>
  </div>`;
}

export async function loadRadar() {
  const up = $('#radar-up');
  const down = $('#radar-down');
  if (!up || !down) return;
  try {
    const r = await api('/api/radar');
    up.innerHTML = (r.up || []).map(i => radarRow(i, true)).join('') || '<p class="muted tiny">Sin datos.</p>';
    down.innerHTML = (r.down || []).map(i => radarRow(i, false)).join('') || '<p class="muted tiny">Sin datos.</p>';
  } catch {
    up.innerHTML = down.innerHTML = '<p class="muted tiny">No disponible.</p>';
  }
}

/* Minigráfico de 7 días (una sola línea, verde si sube y roja si baja) */
export function sparklineWide(values) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const w = 160, h = 36, pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = values[values.length - 1] >= values[0];
  const color = up ? 'var(--pos)' : 'var(--neg)';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
