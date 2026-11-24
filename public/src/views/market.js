'use strict';
// Vista de Mercado: liquidez, deuda, pulso, calendario y miedo/codicia.
import { $, $$, state, api, esc, num, pct, signed, relTime, toast } from '../core.js';
import { chart, themeVars, baseTooltip, hexA } from '../ui/charts.js';

export const LIQ_STATE = {
  exp: { label: 'Expansión', cls: 'chip-ok' },
  neutro: { label: 'Neutro', cls: '' },
  cont: { label: 'Contracción', cls: 'chip-warn' },
}

export function moneyB(v) {
  if (!isFinite(v)) return '—';
  const m = v / 1e6; // millones de dólares, sin ambigüedad
  return num(m, 0) + ' M$';
}

export async function loadLiquidity() {
  try {
    const d = await api('/api/liquidity');
    const st = LIQ_STATE[d.state && d.state.key] || LIQ_STATE.neutro;
    const chip = $('#liq-state');
    if (chip) { chip.textContent = st.label; chip.className = 'chip ' + st.cls; }
    const total = $('#liq-total'); if (total) total.textContent = moneyB(d.total);
    const c24 = $('#liq-24');
    if (c24) {
      const up = d.change24 >= 0;
      c24.textContent = (up ? '+' : '') + num(d.change24, 2) + ' % 24 h';
      c24.className = 'tiny ' + signed(d.change24);
    }
    const c30 = $('#liq-30');
    if (c30) {
      c30.textContent = (d.change30 >= 0 ? '+' : '') + num(d.change30, 2) + ' %';
      c30.className = signed(d.change30);
    }
    const dom = $('#liq-dom');
    if (dom) dom.textContent = d.dominance != null ? num(d.dominance, 2) + ' %' : '—';
    const note = $('#liq-note');
    if (note) note.textContent = d.state && d.state.key === 'cont'
      ? 'Las stablecoins se reducen: hay menos liquidez entrando al mercado.'
      : d.state && d.state.key === 'exp'
        ? 'Entra dinero nuevo: las stablecoins crecen.'
        : 'Saldo estable: sin cambio claro de liquidez.';
    const v = themeVars();
    const series = (d.series || []).map(p => [p[0], p[1]]);
    if (series.length) {
      chart('chart-liq', {
        grid: { left: 0, right: 0, top: 6, bottom: 0 },
        xAxis: { type: 'time', show: false },
        yAxis: { type: 'value', show: false, scale: true },
        tooltip: { ...baseTooltip(v), formatter: (items) => {
          const it = items[0];
          return new Date(it.value[0]).toLocaleDateString('es-ES') + '<br/>' + moneyB(it.value[1]);
        } },
        series: [{
          type: 'line', data: series, showSymbol: false, smooth: true,
          lineStyle: { width: 2, color: d.state && d.state.key === 'cont' ? v.neg : v.pos },
          areaStyle: { opacity: .12, color: d.state && d.state.key === 'cont' ? v.neg : v.pos },
        }],
      });
    }
  } catch (e) {
    const note = $('#liq-note');
    if (note) note.textContent = 'Sin datos de liquidez: ' + e.message;
  }
}

export async function loadCalendar() {
  const box = $('#cal-list');
  if (!box) return;
  try {
    const d = await api('/api/calendar');
    const chip = $('#cal-chip');
    if (!d.configured) {
      if (chip) { chip.textContent = 'Sin clave'; chip.className = 'chip'; }
      box.innerHTML = '<p class="muted tiny">Añade tu clave de FRED en <b>Ajustes → Datos macro</b>.</p>';
      return;
    }
    const items = d.items || [];
    if (chip) { chip.textContent = items.length ? items.length + ' eventos' : 'Sin datos'; chip.className = 'chip'; }
    if (!items.length) { box.innerHTML = '<p class="muted tiny">Sin publicaciones en los próximos 60 días.</p>'; return; }
    const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    box.innerHTML = items.map(it => {
      const near = it.days <= 3;
      const label = it.days === 0 ? 'hoy' : it.days === 1 ? 'mañana' : 'en ' + it.days + ' días';
      return `<div class="cal-row${near ? ' is-near' : ''}">
        <span class="cal-date">${esc(fmt(it.date))}</span>
        <span class="cal-name">${esc(it.name)}</span>
        <span class="cal-days">${esc(label)}</span>
      </div>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<p class="muted tiny">${esc(e.message)}</p>`;
  }
}

// Último dato de pulso (se usa al repintar la tarjeta)
let PULSE = null;

export async function loadPulse() {
  try {
    const d = await api('/api/pulse');
    PULSE = d;
    const b = d.breadth || {};
    const el = $('#pulse-breadth');
    if (el) el.textContent = `${b.up} de ${b.total}`;
    const sub = $('#pulse-breadth-sub');
    if (sub) sub.textContent = num(b.pctUp, 0) + ' % en verde';
    const fill = $('#breadth-fill');
    if (fill) fill.style.width = Math.max(2, Math.min(100, b.pctUp || 0)) + ' %';
    const f = d.funding || {};
    const fe = $('#pulse-funding');
    if (fe) {
      fe.textContent = (f.avg >= 0 ? '+' : '') + num(f.avg, 3) + ' %';
      fe.className = signed(f.avg);
    }
    const fs = $('#pulse-funding-sub');
    if (fs) fs.textContent = 'cada 8 h · mediana ' + num(f.median, 3) + ' %';
    const pos = $('#pulse-pos');
    if (pos) pos.textContent = `${f.positive || 0} de ${f.count || 0}`;
    const chip = $('#pulse-chip');
    if (chip) {
      const pct = b.pctUp || 0;
      const label = pct < 30 ? 'Débil' : pct > 70 ? 'Fuerte' : 'Mixto';
      chip.textContent = label;
      chip.className = 'chip ' + (pct < 30 ? 'chip-warn' : pct > 70 ? 'chip-ok' : '');
    }
    // funding de tus monedas
    const row = $('#pulse-coins');
    if (row) {
      const mine = ((state.portfolio && state.portfolio.coins) || []).map(c => c.symbol).slice(0, 6);
      row.innerHTML = mine.map(sym => {
        const r = f.map ? f.map[sym] : null;
        if (r == null) return '';
        return `<span class="chip ${r >= 0 ? 'chip-ok' : 'chip-warn'}">${esc(sym)} ${r >= 0 ? '+' : ''}${num(r, 3)} %</span>`;
      }).join('') || '<span class="muted tiny">Sin funding para tus monedas (no cotizan en perpetuos).</span>';
    }
    const note = $('#pulse-note');
    if (note) {
      note.textContent = (f.avg || 0) < 0
        ? 'Funding negativo: los cortos pagan a los largos; el mercado está sobrevendido.'
        : 'Funding positivo: los largos pagan; hay más apalancamiento comprador.';
    }
  } catch (e) {
    const note = $('#pulse-note');
    if (note) note.textContent = 'Sin datos: ' + e.message;
  }
}

export async function loadLeverage() {
  try {
    const d = await api('/api/leverage');
    const risk = $('#debt-risk');
    if (risk) {
      const map = { alto: 'Riesgo alto', medio: 'Riesgo medio', bajo: 'Riesgo bajo' };
      const cls = { alto: 'chip-warn', medio: '', bajo: 'chip-ok' };
      risk.textContent = map[d.risk && d.risk.key] || '—';
      risk.className = 'chip ' + (cls[d.risk && d.risk.key] || '');
    }
    const dt = $('#debt-total'); if (dt) dt.textContent = moneyB(d.debt);
    const dc = $('#debt-chg');
    if (dc) { dc.textContent = (d.debtChange30 >= 0 ? '+' : '') + num(d.debtChange30, 2) + ' %'; dc.className = 'tiny ' + signed(d.debtChange30); }
    const ot = $('#oi-total'); if (ot) ot.textContent = moneyB(d.oi);
    const oc = $('#oi-chg');
    if (oc) { oc.textContent = (d.oiChange30 >= 0 ? '+' : '') + num(d.oiChange30, 2) + ' %'; oc.className = 'tiny ' + signed(d.oiChange30); }
    const lr = $('#lev-ratio'); if (lr) lr.textContent = d.leverage != null ? num(d.leverage, 2) + ' %' : '—';
    const note = $('#debt-note');
    if (note) {
      const alto = d.risk && d.risk.key === 'alto';
      note.textContent = alto
        ? 'Suben la deuda y el apalancamiento: más riesgo de liquidaciones en cascada.'
        : 'Deuda y apalancamiento a la baja: menos presión sobre el precio.';
    }
    const v = themeVars();
    const series = d.series || [];
    if (series.length) {
      chart('chart-debt', {
        grid: { left: 0, right: 0, top: 6, bottom: 0 },
        legend: { show: false },
        xAxis: { type: 'category', show: false, data: series.map(p => p.d) },
        yAxis: { type: 'value', show: false, scale: true },
        tooltip: { ...baseTooltip(v), formatter: (its) => {
          const d0 = its[0];
          const row = series[d0.dataIndex];
          if (!row) return '';
          return new Date(row.d).toLocaleDateString('es-ES') +
            '<br/>Deuda: ' + (row.debt ? moneyB(row.debt) : '—') +
            '<br/>OI: ' + (row.oi ? moneyB(row.oi) : '—');
        } },
        series: [
          { name: 'Deuda', type: 'line', data: series.map(p => p.debt), showSymbol: false, smooth: true, lineStyle: { width: 2, color: v.accent } },
          { name: 'OI', type: 'line', data: series.map(p => p.oi), showSymbol: false, smooth: true, lineStyle: { width: 2, color: (d.risk && d.risk.key === 'alto') ? v.neg : v.muted, type: [4, 3] } },
        ],
      });
    }
  } catch (e) {
    const note = $('#debt-note');
    if (note) note.textContent = 'Sin datos de deuda: ' + e.message;
  }
}

export function renderFearGreed() {
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
      lineStyle: { width: 2 },
      areaStyle: { color: hexA(v.accent, .10) },
      markArea: {
        silent: true,
        data: bands.map(b => [{ yAxis: b[0], itemStyle: { color: hexA(b[2], .10) } }, { yAxis: b[1] }]),
        label: { show: false },
      },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: v.muted, type: [3, 3], opacity: .6 }, label: { show: false }, data: [{ yAxis: 50 }] },
    }],
    // La línea se colorea según el tramo de miedo/codicia en el que esté cada punto.
    visualMap: {
      show: false,
      dimension: 1,
      seriesIndex: 0,
      pieces: [
        { lt: 25, color: '#ff6b6b' },
        { gte: 25, lt: 45, color: '#ffab5e' },
        { gte: 45, lt: 56, color: '#9aa7bd' },
        { gte: 56, lt: 76, color: '#5fd99a' },
        { gte: 76, color: '#22c98a' },
      ],
    },
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
