'use strict';
// Trading: gráfico de velas, indicadores, ondas de Wolfe y analista determinista.
import { $, $$, state, api, esc, eur, num, pct, priceFmt, short, signed, dateShort, dateLong } from '../core.js';
import { chart, themeVars, baseTooltip, hexA } from '../ui/charts.js';
import { RANGES, rangeFmt } from '../data/ranges.js';
import { coinColor, coinBadge, rngBlock } from '../ui/coins.js';

/* ------------------------------------------------ trading */
// La app inyecta la lista de seguimiento (vive en app.js).
let getWatch = () => [];
export function initTrade(d = {}) {
  if (typeof d.getWatch === 'function') getWatch = d.getWatch;
}

export function tradeSymbols() {
  const p = state.portfolio;
  const cartera = (p && Array.isArray(p.coins) ? p.coins.map(c => c.symbol) : []);
  const seguidas = getWatch() || [];
  const todos = [...new Set([...cartera, ...seguidas])];
  return todos.sort();
}

function initTradeControls() {
  const sel = $('#trade-symbol');
  if (!sel || sel.dataset.ready === '1') return;
  const syms = tradeSymbols();
  if (!syms.length) return;
  sel.innerHTML = syms.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.dataset.ready = '1';
  sel.value = state.tradeSymbol || syms[0];
  sel.addEventListener('change', () => { state.tradeSymbol = sel.value; loadTradeChart(); });
  $$('#trade-intervals button').forEach(b => b.addEventListener('click', () => {
    $$('#trade-intervals button').forEach(x => x.classList.toggle('is-active', x === b));
    if (b.dataset.iv === 'all') {
      state.tradeAll = true;
    } else {
      state.tradeAll = false;
      state.tradeInterval = b.dataset.iv;
    }
    loadTradeChart();
  }));
  $$('#trade-wolfe button').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.wolfe;
    if (act === 'clear') state.wolfe = { mode: 'off', pts: [] };
    else state.wolfe = { mode: state.wolfe.mode === act ? 'off' : act, pts: [] };
    $$('#trade-wolfe button').forEach(x => x.classList.toggle('is-active', x.dataset.wolfe === state.wolfe.mode));
    loadTradeChart();
  }));
  $$('#trade-indicators button').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.ind;
    state.tradeInd[key] = !state.tradeInd[key];
    b.classList.toggle('is-active', state.tradeInd[key]);
    loadTradeChart();
  }));
}

export async function loadTradeChart() {
  initTradeControls();
  const syms = tradeSymbols();
  const sym = state.tradeSymbol || syms[0];
  const stats = $('#trade-stats');
  if (!sym) { if (stats) stats.textContent = 'Sin monedas en la cartera.'; return; }
  state.tradeSymbol = sym;
  const sel = $('#trade-symbol');
  if (sel && sel.value !== sym) sel.value = sym;
  const iv = state.tradeInterval || '1h';
  if (stats) stats.textContent = 'Cargando…';
  try {
    const limite = state.tradeAll ? 1000 : 300;
    const r = await api(`/api/candles?symbol=${encodeURIComponent(sym)}&interval=${iv}&limit=${limite}`);
    renderCandles(sym, iv, r.candles || []);
    loadRegime(sym);
    loadRegimeWatch();
    // Análisis automático la primera vez para cada moneda e intervalo
    if (state.analystKey !== analystKeyFor(sym, iv) && $('#analyst-btn')) runAnalyst();
  } catch (e) {
    if (stats) stats.textContent = 'Sin datos: ' + e.message;
  }
}

/* --- medias e indicadores (cálculo local, sin librerías) --- */
function sma(arr, n) {
  return arr.map((_, i) => (i < n - 1 ? '-' : arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
}
function ema(arr, n) {
  const k = 2 / (n + 1);
  let prev = null;
  return arr.map((v, i) => {
    if (i < n - 1) return '-';
    if (prev === null) { prev = arr.slice(0, n).reduce((a, b) => a + b, 0) / n; return prev; }
    prev = v * k + prev * (1 - k);
    return prev;
  });
}
function stdev(arr, n, mean) {
  return arr.map((_, i) => {
    if (i < n - 1) return '-';
    const slice = arr.slice(i - n + 1, i + 1);
    const m = mean[i] === '-' ? slice.reduce((a, b) => a + b, 0) / n : mean[i];
    return Math.sqrt(slice.reduce((a, b) => a + (b - m) * (b - m), 0) / n);
  });
}
function rsiSeries(closes, n = 14) {
  const out = closes.map(() => '-');
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
function macdSeries(closes) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const dif = closes.map((_, i) => (fast[i] === '-' || slow[i] === '-' ? '-' : fast[i] - slow[i]));
  const filled = dif.map(v => (v === '-' ? 0 : v));
  const sig = ema(filled, 9);
  const hist = dif.map((v, i) => (v === '-' ? '-' : (v - sig[i]) * 2));
  return { dif, sig, hist };
}

/* --- Ondas de Wolfe: pivotes, detección automática y dibujo --- */
function zigzagPivots(rows, k = 5) {
  const out = [];
  for (let i = k; i < rows.length - k; i++) {
    const hi = rows[i][2];
    const lo = rows[i][3];
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (rows[j][2] >= hi) isH = false;
      if (rows[j][3] <= lo) isL = false;
    }
    if (isH) out.push({ i, price: hi, type: 'H' });
    else if (isL) out.push({ i, price: lo, type: 'L' });
  }
  return out;
}

function detectWolfe(rows, k = 5) {
  const raw = zigzagPivots(rows, k);
  if (raw.length < 5) return null;
  // comprimir pivotes seguidos del mismo tipo, quedándonos con el extremo
  const seq = [];
  for (const q of raw) {
    const last = seq[seq.length - 1];
    if (!last) { seq.push(q); continue; }
    if (last.type === q.type) {
      if ((q.type === 'H' && q.price > last.price) || (q.type === 'L' && q.price < last.price)) seq[seq.length - 1] = q;
    } else seq.push(q);
  }
  if (seq.length < 5) return null;
  const [p1, p2, p3, p4, p5] = seq.slice(-5);
  if (p1.type === 'L') {
    // Wolfe alcista: 2 por encima de 1 y 3 · 4 por debajo de 2 · 5 por encima de 3
    if (!(p2.price > p1.price && p2.price > p3.price)) return null;
    if (!(p3.price < p2.price && p4.price < p2.price)) return null;
    if (!(p4.price > p3.price)) return null;
    if (!(p5.price > p3.price)) return null;
  } else {
    if (!(p2.price < p1.price && p2.price < p3.price)) return null;
    if (!(p3.price > p2.price && p4.price > p2.price)) return null;
    if (!(p4.price < p3.price)) return null;
    if (!(p5.price < p3.price)) return null;
  }
  return [p1, p2, p3, p4, p5];
}

/* Línea EPA: prolongación de 1-3 hasta el final del gráfico */
function epaLine(pts, lastIdx) {
  const a = pts[0];
  const b = pts[2];
  if (!a || !b || b.i === a.i) return [];
  const slope = (b.price - a.price) / (b.i - a.i);
  return [[a.i, a.price], [lastIdx, a.price + slope * (lastIdx - a.i)]];
}

function wolfePoints(rows) {
  const mode = state.wolfe ? state.wolfe.mode : 'off';
  if (mode === 'auto') return detectWolfe(rows) || [];
  if (mode === 'manual') return (state.wolfe.pts || []).slice(0, 5);
  return [];
}

function wolfeSeries(rows) {
  const v = themeVars();
  const pts = wolfePoints(rows);
  const data = pts.map(p => [p.i, p.price]);
  const epa = pts.length >= 3 ? epaLine(pts, rows.length - 1) : [];
  return [
    {
      id: 'wolfe', name: 'Wolfe', type: 'line', data, symbol: 'circle', symbolSize: 6,
      lineStyle: { color: '#f0b429', width: 1.8 }, itemStyle: { color: '#f0b429' },
      label: { show: true, position: 'top', color: '#f0b429', fontSize: 10, formatter: (p) => String(p.dataIndex + 1) },
      xAxisIndex: 0, yAxisIndex: 0, z: 6, tooltip: { show: false },
    },
    {
      id: 'wolfeEpa', name: 'EPA', type: 'line', data: epa, symbol: 'none',
      lineStyle: { color: hexA('#f0b429', .55), width: 1, type: 'dashed' },
      xAxisIndex: 0, yAxisIndex: 0, z: 5, tooltip: { show: false },
    },
  ];
}

function updateWolfe(inst, rows) {
  if (!inst) return;
  const [w, e] = wolfeSeries(rows);
  inst.setOption({ series: [{ id: 'wolfe', data: w.data }, { id: 'wolfeEpa', data: e.data }] });
  const stats = $('#trade-stats');
  if (stats && state.wolfe.mode === 'manual') {
    const n = (state.wolfe.pts || []).length;
    stats.innerHTML = n >= 5
      ? 'Wolfe manual: <b>5/5</b> puntos · pulsa ✕ para borrar'
      : `Wolfe manual: marca <b>${n}/5</b> puntos en el gráfico`;
  }
}

function bindWolfeClicks(inst, rows) {
  if (!inst) return;
  inst.getZr().off('click');
  inst.getZr().on('click', (e) => {
    if (!state.wolfe || state.wolfe.mode !== 'manual') return;
    const p = inst.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return;
    const i = Math.max(0, Math.min(rows.length - 1, Math.round(p[0])));
    state.wolfe.pts.push({ i, price: p[1] });
    if (state.wolfe.pts.length > 5) state.wolfe.pts = state.wolfe.pts.slice(-5);
    updateWolfe(inst, rows);
  });
}

/* ------------------------------------------------ analista determinista */
function analystKeyFor(sym, iv) {
  const ind = Object.keys(state.tradeInd || {}).filter(k => state.tradeInd[k]).sort().join(',');
  const w = (state.wolfe && state.wolfe.mode) || 'off';
  return `${sym}|${iv}|${ind}|${w}`;
}

async function runAnalyst() {
  const out = $('#analyst-out');
  const sub = $('#analyst-sub');
  const btn = $('#analyst-btn');
  if (!out) return;
  const sym = state.tradeSymbol || (tradeSymbols()[0] || '');
  const iv = state.tradeInterval || '1h';
  if (!sym) { out.innerHTML = '<p class="muted tiny">Sin monedas en la cartera.</p>'; return; }
  state.analystKey = analystKeyFor(sym, iv);
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
  try {
    const ind = Object.keys(state.tradeInd || {}).filter(k => state.tradeInd[k]).join(',');
    const wolfeOn = state.wolfe && state.wolfe.mode && state.wolfe.mode !== 'off';
    const d = await api(`/api/analyze?symbol=${encodeURIComponent(sym)}&interval=${iv}&ind=${encodeURIComponent(ind)}`);
    if (!d.ok) throw new Error(d.error || 'Sin datos');
    if (sub) sub.textContent = `${sym} · ${iv} · ${new Date(d.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    const extra = [];
    if (wolfeOn) {
      const pts = (typeof detectWolfe === 'function' && state.tradeRows) ? detectWolfe(state.tradeRows) : null;
      extra.push({
        title: 'Wolfe',
        text: pts && pts.length >= 5
          ? `Patrón detectado con ${pts.length} puntos; el quinto en ${priceFmt(pts[4].price)}. Objetivo estimado (línea EPA) hacia ${priceFmt(pts[2].price)}.`
          : 'Sin patrón Wolfe claro con las velas actuales. Si lo ves a mano, activa «Wolfe → Lápiz» y márcalo.',
      });
    }
    out.innerHTML = (d.sections || []).concat(extra).map(s => `
      <div class="analyst-block">
        <span class="analyst-title">${esc(s.title)}</span>
        <p>${esc(s.text)}</p>
      </div>`).join('') +
      `<details class="analyst-facts"><summary>Números usados</summary>
        <div class="analyst-facts-grid">${(d.facts || []).map(f => `<span>${esc(f.label)}</span><b>${esc(f.value)}</b>`).join('')}</div>
      </details>`;
  } catch (e) {
    out.innerHTML = `<p class="muted tiny">${esc(e.message)}</p>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Analizar'; }
  }
}

$('#analyst-btn')?.addEventListener('click', runAnalyst);

function renderCandles(symbol, interval, rows) {
  state.tradeRows = rows;
  const prevInst = echarts.getInstanceByDom(document.getElementById('chart-trade'));
  if (prevInst) prevInst.__manualY = false;
  const stats = $('#trade-stats');
  if (!rows.length) { if (stats) stats.textContent = 'Sin velas para esa moneda.'; return; }
  const v = themeVars();
  const ind = state.tradeInd || {};
  const label = (ts) => {
    const d = new Date(ts);
    return interval === '1d'
      ? d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
      : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const cats = rows.map(r => label(r[0]));
  const ohlc = rows.map(r => [r[1], r[4], r[3], r[2]]);
  const closes = rows.map(r => r[4]);
  const vols = rows.map(r => ({ value: r[5], itemStyle: { color: r[4] >= r[1] ? hexA(v.pos, .5) : hexA(v.neg, .5) } }));
  const last = closes[closes.length - 1];
  const chg = closes.length > 1 ? ((last - closes[0]) / closes[0]) * 100 : 0;
  if (stats) {
    const wolfNote = (state.wolfe && state.wolfe.mode === 'auto' && !wolfePoints(rows).length)
      ? ' · <span class="muted">Wolfe auto: sin patrón claro</span>' : '';
    stats.innerHTML = `<b>${esc(symbol)}-EUR</b> · ${priceFmt(last)} · <span class="${signed(chg)}">${chg >= 0 ? '+' : ''}${num(chg, 2)} %</span> en el periodo${wolfNote}`;
  }

  // --- paneles según indicadores activos
  const panes = [{ key: 'price', w: 4 }, { key: 'vol', w: 1.1 }];
  if (ind.rsi) panes.push({ key: 'rsi', w: 1.3 });
  if (ind.macd) panes.push({ key: 'macd', w: 1.3 });
  const gaps = 3 * (panes.length - 1) + 6;
  const usable = 84 - gaps;
  const weight = panes.reduce((a, p) => a + p.w, 0);
  let cursor = 4;
  const grids = [], xAxes = [], yAxes = [];
  panes.forEach((pane, i) => {
    const h = (usable * pane.w) / weight;
    grids.push({ left: 8, right: 64, top: cursor + '%', height: h + '%' });
    xAxes.push({
      type: 'category', gridIndex: i, data: cats,
      axisLine: { lineStyle: { color: v.line } },
      axisLabel: { show: pane.key === panes[panes.length - 1].key, color: v.muted, fontSize: 10 },
      axisTick: { show: false }, splitLine: { show: false },
    });
    const priceAxis = pane.key === 'price';
    yAxes.push({
      gridIndex: i, scale: true, position: 'right',
      axisLabel: {
        show: priceAxis, color: v.muted, fontSize: 10,
        formatter: (n) => priceFmt(n),
      },
      splitLine: { lineStyle: { color: v.line, type: 'dashed' }, show: priceAxis },
    });
    cursor += h + 3;
  });

  const seriesList = [{
    name: symbol, type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
    itemStyle: { color: v.pos, color0: v.neg, borderColor: v.pos, borderColor0: v.neg },
  }];

  if (ind.ma) {
    seriesList.push({ name: 'MA20', type: 'line', data: sma(closes, 20), symbol: 'none', smooth: true, lineStyle: { width: 1.3, color: v.accent }, xAxisIndex: 0, yAxisIndex: 0, z: 3 });
    seriesList.push({ name: 'MA50', type: 'line', data: sma(closes, 50), symbol: 'none', smooth: true, lineStyle: { width: 1.2, color: v.accent2 }, xAxisIndex: 0, yAxisIndex: 0, z: 3 });
  }
  if (ind.boll) {
    const mid = sma(closes, 20);
    const sd = stdev(closes, 20, mid);
    const up = closes.map((_, i) => (sd[i] === '-' ? '-' : mid[i] + sd[i] * 2));
    const lo = closes.map((_, i) => (sd[i] === '-' ? '-' : mid[i] - sd[i] * 2));
    seriesList.push({ name: 'Boll +2', type: 'line', data: up, symbol: 'none', lineStyle: { width: 1, color: hexA(v.accent, .55) }, xAxisIndex: 0, yAxisIndex: 0, z: 2 });
    seriesList.push({ name: 'Boll -2', type: 'line', data: lo, symbol: 'none', lineStyle: { width: 1, color: hexA(v.accent, .55) }, xAxisIndex: 0, yAxisIndex: 0, z: 2 });
  }
  const volSeries = { name: 'Volumen', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: '60%' };
  seriesList.push(volSeries);
  seriesList.push(...wolfeSeries(rows));

  if (ind.rsi) {
    const idx = panes.findIndex(p => p.key === 'rsi');
    seriesList.push({
      name: 'RSI', type: 'line', data: rsiSeries(closes), symbol: 'none', smooth: true,
      lineStyle: { width: 1.3, color: v.accent2 }, xAxisIndex: idx, yAxisIndex: idx, z: 3,
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: hexA(v.muted, .5), type: 'dashed', width: 1 },
        label: { show: false },
        data: [{ yAxis: 70 }, { yAxis: 30 }],
      },
    });
  }
  if (ind.macd) {
    const idx = panes.findIndex(p => p.key === 'macd');
    const m = macdSeries(closes);
    seriesList.push({
      name: 'MACD', type: 'bar', data: m.hist.map(h => ({ value: h, itemStyle: { color: h === '-' ? 'transparent' : (h >= 0 ? hexA(v.pos, .55) : hexA(v.neg, .55)) } })),
      xAxisIndex: idx, yAxisIndex: idx,
    });
    seriesList.push({ name: 'Dif', type: 'line', data: m.dif, symbol: 'none', lineStyle: { width: 1.2, color: v.accent }, xAxisIndex: idx, yAxisIndex: idx });
    seriesList.push({ name: 'Señal', type: 'line', data: m.sig, symbol: 'none', lineStyle: { width: 1.1, color: v.accent2 }, xAxisIndex: idx, yAxisIndex: idx });
  }

  const inst = chart('chart-trade', {
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(8,12,20,.95)', borderWidth: 0, padding: [8, 10],
      extraCssText: 'box-shadow:0 12px 30px -14px rgba(0,0,0,.9);border-radius:10px;',
      formatter: (ps) => {
        const idx = ps && ps[0] ? ps[0].dataIndex : 0;
        const r = rows[idx];
        if (!r) return '';
        const up = r[4] >= r[1];
        return `<div style="font-size:11.5px;color:${v.muted}">${cats[idx]}</div>
          <div style="margin-top:4px;color:${up ? v.pos : v.neg};font-weight:650">${priceFmt(r[4])}</div>
          <div style="margin-top:3px;font-size:11.5px">Apertura <b>${priceFmt(r[1])}</b></div>
          <div style="font-size:11.5px">Máximo <b>${priceFmt(r[2])}</b></div>
          <div style="font-size:11.5px">Mínimo <b>${priceFmt(r[3])}</b></div>
          <div style="font-size:11.5px">Volumen <b>${num(r[5], 0)}</b></div>`;
      },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: xAxes.map((_, i) => i), start: state.tradeAll ? 0 : 55, end: 100, moveOnMouseMove: true, zoomOnMouseWheel: true, zoomOnPinch: true },
      {
        type: 'slider', xAxisIndex: xAxes.map((_, i) => i), height: 16, bottom: 6, borderColor: 'transparent',
        backgroundColor: 'rgba(255,255,255,.03)', fillerColor: 'rgba(139,164,255,.12)',
        handleStyle: { color: v.accent }, textStyle: { color: v.muted, fontSize: 10 },
        dataBackground: { lineStyle: { color: v.line }, areaStyle: { color: 'transparent' } },
      },
    ],
    series: seriesList,
  });

  // doble clic: volver al zoom inicial
  if (!inst.__dblReset) {
    inst.__dblReset = true;
    inst.getZr().on('dblclick', () => {
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: state.tradeAll ? 0 : 55, end: 100 });
    });
  }

  // Fibonacci sobre el tramo visible (se recalcula al hacer zoom)
  const spans = [[0, '0 %'], [0.236, '23,6 %'], [0.382, '38,2 %'], [0.5, '50 %'], [0.618, '61,8 %'], [0.786, '78,6 %'], [1, '100 %']];
  const applyFib = (startPct, endPct) => {
    if (!inst || !ind.fib) return;
    const a = Math.max(0, Math.floor((startPct / 100) * rows.length));
    const b = Math.min(rows.length, Math.ceil((endPct / 100) * rows.length));
    const slice = rows.slice(a, Math.max(b, a + 2));
    if (!slice.length) return;
    const hi = Math.max(...slice.map(r => r[2]));
    const lo = Math.min(...slice.map(r => r[3]));
    inst.setOption({
      series: [{
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: hexA(v.accent, .35), type: 'dashed', width: 1 },
          label: { position: 'insideStartTop', color: v.muted, fontSize: 9.5, backgroundColor: 'rgba(8,12,20,.55)', padding: [1, 4], borderRadius: 3 },
          data: spans.map(([f, name]) => ({ yAxis: hi - (hi - lo) * f, name })),
        },
      }],
    });
  };
  if (inst) {
    bindWolfeClicks(inst, rows);
    let fibTimer = null;
    inst.off('dataZoom');
    inst.on('dataZoom', () => {
      clearTimeout(fibTimer);
      fibTimer = setTimeout(() => {
        const opt = inst.getOption();
        const dz = (opt.dataZoom || [])[0] || {};
        const startPct = dz.start == null ? 55 : dz.start;
        const endPct = dz.end == null ? 100 : dz.end;
        applyFib(startPct, endPct);

        // Autoescala del precio a las velas visibles (como TradingView), salvo que
        // el usuario haya escalado el eje a mano con Shift + rueda.
        const yz = (opt.dataZoom || []).find(d => d.yAxisIndex !== undefined);
        const manualY = inst.__manualY === true
          || !!(yz && yz.start != null && !(yz.start === 0 && yz.end === 100));
        if (!manualY) {
          const a = Math.max(0, Math.floor((startPct / 100) * rows.length));
          const b = Math.min(rows.length, Math.ceil((endPct / 100) * rows.length));
          const slice = rows.slice(a, Math.max(b, a + 2));
          if (slice.length) {
            const hi = Math.max(...slice.map(r => r[2]));
            const lo = Math.min(...slice.map(r => r[3]));
            const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
            const y0 = { ...yAxes[0], min: lo - pad, max: hi + pad };
            inst.setOption({ yAxis: yAxes.map((ax, i) => (i === 0 ? y0 : ax)) }, { lazyUpdate: true });
          }
        }
      }, 120);
    });
    const dz0 = (inst.getOption().dataZoom || [])[0] || {};
    applyFib(dz0.start == null ? 55 : dz0.start, dz0.end == null ? 100 : dz0.end);
  }
}
