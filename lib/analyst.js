'use strict';
// Analista determinista: convierte los indicadores en un resumen en español.
// Ninguna frase se inventa: todas salen de un número calculado aquí.

function sma(values, n) {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function ema(values, n) {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values, n = 14) {
  if (values.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function atr(rows, n = 14) {
  if (rows.length < n + 1) return null;
  const trs = [];
  for (let i = rows.length - n; i < rows.length; i++) {
    const [, , high, low] = [0, 0, rows[i][2], rows[i][3]];
    const prevClose = rows[i - 1][4];
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function fmt(v, dec = 2) {
  if (!isFinite(v)) return '—';
  const neg = v < 0;
  const s = Math.abs(v).toFixed(dec);
  const [ent, frac] = s.split('.');
  return (neg ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? ',' + frac : '');
}

function priceFmt(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a < 1 ? 4 : a < 10 ? 3 : 2;
  return fmt(v, d) + ' €';
}

/** rows: [ts, open, high, low, close, volume] en orden cronológico. */
function analyze({ rows, symbol, portfolio, plans }) {
  if (!rows || rows.length < 60) return { ok: false, error: 'Faltan velas para analizar' };

  const closes = rows.map(r => r[4]);
  const vol = rows.map(r => r[5]);
  const last = closes[closes.length - 1];
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12 != null && ema26 != null ? ema12 - ema26 : null;
  const macdSeries = [];
  for (let i = 60; i <= closes.length; i++) {
    const e12 = ema(closes.slice(0, i), 12);
    const e26 = ema(closes.slice(0, i), 26);
    if (e12 != null && e26 != null) macdSeries.push(e12 - e26);
  }
  const macdSignal = macdSeries.length >= 9 ? ema(macdSeries, 9) : null;
  const a14 = atr(rows, 14);

  const window40 = rows.slice(-40);
  const support = Math.min(...window40.map(r => r[3]));
  const resistance = Math.max(...window40.map(r => r[2]));

  const v10 = sma(vol, 10);
  const v30 = sma(vol, 30);
  const volRatio = v10 && v30 ? v10 / v30 : null;

  const sections = [];

  // --- Tendencia
  const below50 = ma50 != null && last < ma50;
  const below20 = ma20 != null && last < ma20;
  const ma20vs50 = ma20 != null && ma50 != null ? ma20 - ma50 : null;
  let trend;
  if (below20 && below50) trend = 'Bajista';
  else if (!below20 && !below50 && ma20vs50 > 0) trend = 'Alcista';
  else trend = 'Lateral';
  sections.push({
    title: 'Tendencia',
    text: `${trend}. Precio ${priceFmt(last)} ` +
      `${ma50 != null ? (below50 ? 'por debajo' : 'por encima') + ' de la media de 50 (' + priceFmt(ma50) + ')' : ''}` +
      `${ma20 != null ? ' y ' + (below20 ? 'por debajo' : 'por encima') + ' de la de 20 (' + priceFmt(ma20) + ')' : ''}.` +
      `${ma20vs50 != null ? ' La media de 20 está ' + (ma20vs50 >= 0 ? 'por encima' : 'por debajo') + ' de la de 50 (' + fmt((ma20vs50 / ma50) * 100, 2) + ' %).' : ''}`,
  });

  // --- Momento
  let rsiTxt = 'sin datos';
  if (rsi14 != null) {
    if (rsi14 < 30) rsiTxt = `RSI ${fmt(rsi14, 1)}: sobreventa`;
    else if (rsi14 < 45) rsiTxt = `RSI ${fmt(rsi14, 1)}: débil, cerca de sobreventa`;
    else if (rsi14 <= 55) rsiTxt = `RSI ${fmt(rsi14, 1)}: neutro`;
    else if (rsi14 <= 70) rsiTxt = `RSI ${fmt(rsi14, 1)}: fuerte`;
    else rsiTxt = `RSI ${fmt(rsi14, 1)}: sobrecompra`;
  }
  let macdTxt = '';
  if (macd != null) {
    const cruz = macdSignal != null ? (macd > macdSignal ? 'por encima de su señal' : 'por debajo de su señal') : '';
    macdTxt = `MACD ${macd >= 0 ? 'positivo' : 'negativo'}${cruz ? ' y ' + cruz : ''}.`;
  }
  const volTxt = volRatio != null
    ? `Volumen ${volRatio >= 1.1 ? 'por encima de' : volRatio <= 0.9 ? 'por debajo de' : 'en línea con'} la media (${fmt(volRatio * 100, 0)} %).`
    : '';
  sections.push({ title: 'Momento', text: `${rsiTxt}. ${macdTxt} ${volTxt}`.trim() });

  // --- Zonas
  const dSup = ((last - support) / last) * 100;
  const dRes = ((resistance - last) / last) * 100;
  sections.push({
    title: 'Zonas',
    text: `Soporte ${priceFmt(support)} (${fmt(dSup, 1)} % por debajo). ` +
      `Resistencia ${priceFmt(resistance)} (${fmt(dRes, 1)} % por encima). ` +
      `Rango de las últimas 40 velas: ${fmt(((resistance - support) / support) * 100, 1)} %.`,
  });

  // --- Tu cartera
  const coin = portfolio && Array.isArray(portfolio.coins) ? portfolio.coins.find(c => c.symbol === symbol) : null;
  if (coin) {
    const weight = portfolio.totalValue ? (coin.value / portfolio.totalValue) * 100 : null;
    const avg = coin.avgPrice;
    const need = avg && avg > 0 ? Math.abs(((last - avg) / avg) * 100) : null;
    const aboveAvg = avg && last >= avg;
    const drop20 = coin.value * 0.2;
    const planText = (() => {
      const p = (plans || []).find(x => x.symbol === symbol);
      if (!p) return '';
      const left = (p.tranches || []).filter(t => t.status !== 'done');
      if (!left.length) return 'Plan completado.';
      return `Plan: ${left.length} tramo(s) pendiente(s) (${left.map(t => priceFmt(t.price)).join(' · ')}).`;
    })();
    sections.push({
      title: 'Tu cartera',
      text: `${symbol} es el ${weight != null ? fmt(weight, 1) + ' %' : '—'} de tu cartera ` +
        `(${priceFmt(coin.value)}). ` +
        `${avg ? 'Tu precio medio es ' + priceFmt(avg) + ': estás ' + fmt(need, 1) + ' % ' + (aboveAvg ? 'por encima' : 'por debajo') + '. ' : ''}` +
        `Un −20 % desde aquí serían ${priceFmt(-drop20)}. ${planText}`,
    });
  }

  const facts = [
    ['Precio', priceFmt(last)],
    ['Media 20', ma20 != null ? priceFmt(ma20) : '—'],
    ['Media 50', ma50 != null ? priceFmt(ma50) : '—'],
    ['RSI 14', rsi14 != null ? fmt(rsi14, 1) : '—'],
    ['MACD', macd != null ? fmt(macd, 4) : '—'],
    ['ATR 14', a14 != null ? priceFmt(a14) : '—'],
    ['Volumen', volRatio != null ? fmt(volRatio * 100, 0) + ' %' : '—'],
    ['Soporte', priceFmt(support)],
    ['Resistencia', priceFmt(resistance)],
  ].map(([label, value]) => ({ label, value }));

  return { ok: true, symbol, sections, facts, trend };
}

module.exports = { analyze };
