'use strict';
// Detector de régimen y volatilidad: responde "¿en qué estado está el mercado?"
// sin predecir la dirección. Todo sale de las velas; nada se inventa.
const { sma, stdev, logReturns, atr, adx, slope, percentileSeries, clampi } = require('./indicators');

const MIN_CANDLES = 60;

function annualizedVol(returns, n = 30) {
  const sd = stdev(returns, n);
  return sd == null ? null : sd * Math.sqrt(365);
}

/** Serie histórica de volatilidad anualizada de 30 días. */
function volHistory(returns, window = 30) {
  const out = [];
  for (let i = window; i <= returns.length; i++) {
    const sd = stdev(returns.slice(i - window, i), window);
    if (sd != null) out.push(sd * Math.sqrt(365));
  }
  return out;
}

function detectRegime(candles) {
  const rows = Array.isArray(candles) ? candles.filter(c => Array.isArray(c) && c.length >= 5) : [];
  if (rows.length < MIN_CANDLES) {
    return { ok: false, error: 'Hacen falta al menos ' + MIN_CANDLES + ' velas diarias.' };
  }
  const closes = rows.map(r => Number(r[4])).filter(n => isFinite(n) && n > 0);
  if (closes.length < MIN_CANDLES) return { ok: false, error: 'Cierres insuficientes.' };

  const price = closes[closes.length - 1];
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const adxV = adx(rows, 14);
  const atrV = atr(rows, 14);
  const returns = logReturns(closes);
  const vol30 = annualizedVol(returns, 30);
  const volHist = volHistory(returns, 30);
  const volPct = vol30 != null && volHist.length ? percentileSeries(volHist, vol30) : null;
  const pend = slope(closes.slice(-60), 30);

  // --- tendencia: alineación de precio y medias + pendiente
  let trend = 'lateral';
  if (ma50 != null) {
    if (ma200 != null) {
      if (price > ma50 && ma50 > ma200) trend = 'alcista';
      else if (price < ma50 && ma50 < ma200) trend = 'bajista';
    } else {
      trend = price > ma50 ? 'alcista' : 'bajista';
    }
  }
  // Si la pendiente contradice la alineación, es más honesto decir lateral.
  if (trend !== 'lateral' && pend != null) {
    if (trend === 'alcista' && pend < 0) trend = 'lateral';
    if (trend === 'bajista' && pend > 0) trend = 'lateral';
  }

  // --- fuerza de la tendencia (ADX)
  let strength = null;
  if (adxV) strength = adxV.adx >= 25 ? 'fuerte' : adxV.adx >= 20 ? 'moderada' : 'débil';

  // --- volatilidad relativa a su propia historia
  let volState = null;
  if (volPct != null) volState = volPct >= 0.67 ? 'alta' : volPct <= 0.33 ? 'baja' : 'media';

  // --- tamaño sugerido: sube con vol baja, baja con vol alta y sin tendencia
  let riskMultiplier = 1;
  if (volState === 'alta') riskMultiplier = 0.5;
  else if (volState === 'media') riskMultiplier = 0.75;
  if (trend === 'lateral' && strength === 'débil') riskMultiplier *= 0.75;
  riskMultiplier = Math.round(clampi(riskMultiplier, 0.25, 1) * 100) / 100;

  // --- confianza: cuánto se sostiene la lectura
  let confidence = 50;
  if (adxV) confidence += clampi((adxV.adx - 20) * 1.5, -25, 25);
  if (ma200 != null) confidence += price > ma200 ? 8 : -8;
  if (trend === 'lateral') confidence -= 5;
  confidence = Math.round(clampi(confidence, 0, 100));

  const atrPct = atrV != null && price > 0 ? atrV / price : null;
  const factors = [
    { label: 'Tendencia', value: trend, tone: trend === 'alcista' ? 'up' : trend === 'bajista' ? 'down' : 'flat' },
    { label: 'Fuerza (ADX 14)', value: adxV ? adxV.adx.toFixed(1) + (strength ? ' · ' + strength : '') : '—', tone: 'flat' },
    { label: 'Volatilidad 30 d', value: vol30 != null ? (vol30 * 100).toFixed(1) + ' % anual' : '—', tone: volState === 'alta' ? 'down' : volState === 'baja' ? 'up' : 'flat' },
    { label: 'Percentil de volatilidad', value: volPct != null ? Math.round(volPct * 100) + ' %' : '—', tone: 'flat' },
    { label: 'ATR 14', value: atrPct != null ? (atrPct * 100).toFixed(2) + ' % del precio' : '—', tone: 'flat' },
    { label: 'Precio / SMA 200', value: ma200 != null ? ((price / ma200 - 1) * 100).toFixed(1) + ' %' : '—', tone: price > (ma200 || price) ? 'up' : 'down' },
  ];

  const parts = [];
  if (trend === 'lateral') {
    parts.push(adxV && adxV.adx >= 25 ? 'Sin dirección clara: hay movimiento fuerte pero las medias no se alinean' : 'Mercado lateral');
  } else {
    parts.push(trend === 'alcista' ? 'Tendencia alcista' : 'Tendencia bajista');
    if (strength) parts.push('de fuerza ' + strength);
  }
  if (volState) {
    parts.push('con volatilidad ' + volState);
    if (volPct != null) parts.push('(percentil ' + Math.round(volPct * 100) + ')');
  }
  const text = parts.join(' ') + '.';

  let advice;
  if (riskMultiplier >= 0.9) advice = 'Condiciones normales: puedes usar el tamaño habitual.';
  else if (volState === 'alta' && trend !== 'lateral') advice = 'Volatilidad alta con tendencia: reduce el tamaño y ajusta el stop.';
  else if (volState === 'alta') advice = 'Volatilidad alta y sin dirección: tamaño reducido, mejor esperar una señal clara.';
  else if (trend === 'lateral') advice = 'Mercado lateral: menos tamaño y menos operaciones.';
  else advice = 'Volatilidad media: reduce algo el tamaño respecto a lo habitual.';

  return {
    ok: true,
    price, trend, strength, volState,
    adx: adxV ? { value: adxV.adx, plusDI: adxV.plusDI, minusDI: adxV.minusDI } : null,
    vol30, volPercentile: volPct,
    atrPct,
    ma20, ma50, ma200,
    confidence,
    riskMultiplier,
    text,
    advice,
    factors,
    candles: rows.length,
  };
}

module.exports = { detectRegime, annualizedVol, volHistory, MIN_CANDLES };
