'use strict';
// Indicadores técnicos puros (sin red, sin estado). Todo devuelve null si no hay
// datos suficientes, para no inventar cifras.

function clampi(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function sma(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function stdev(values, n) {
  if (!Array.isArray(values) || values.length < n || n < 2) return null;
  const slice = values.slice(-n);
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/** RSI de Wilder sobre el último valor. */
function rsi(values, n = 14) {
  if (!Array.isArray(values) || values.length < n + 1) return null;
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
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Retornos logarítmicos diarios a partir de los cierres. */
function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

/** ATR de Wilder sobre velas [ts, open, high, low, close, volume]. */
function atr(candles, n = 14) {
  if (!Array.isArray(candles) || candles.length < n + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i][2];
    const l = candles[i][3];
    const pc = candles[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < n) return null;
  let v = trs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < trs.length; i++) v = (v * (n - 1) + trs[i]) / n;
  return v;
}

/** ADX con DI+ y DI- (Wilder). */
function adx(candles, n = 14) {
  if (!Array.isArray(candles) || candles.length < 2 * n + 1) return null;
  const trs = [];
  const plus = [];
  const minus = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i][2];
    const l = candles[i][3];
    const ph = candles[i - 1][2];
    const pl = candles[i - 1][3];
    const pc = candles[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph;
    const down = pl - l;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
  }
  const wilder = arr => {
    let v = arr.slice(0, n).reduce((a, b) => a + b, 0);
    const out = [v];
    for (let i = n; i < arr.length; i++) {
      v = v - v / n + arr[i];
      out.push(v);
    }
    return out;
  };
  const trS = wilder(trs);
  const pS = wilder(plus);
  const mS = wilder(minus);
  const dxs = [];
  for (let i = 0; i < trS.length; i++) {
    if (trS[i] <= 0) continue;
    const pdi = (pS[i] / trS[i]) * 100;
    const mdi = (mS[i] / trS[i]) * 100;
    const sum = pdi + mdi;
    if (sum > 0) dxs.push((Math.abs(pdi - mdi) / sum) * 100);
  }
  if (dxs.length < n) return null;
  let v = dxs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < dxs.length; i++) v = (v * (n - 1) + dxs[i]) / n;
  const lastTR = trS[trS.length - 1];
  return {
    adx: v,
    plusDI: lastTR > 0 ? (pS[pS.length - 1] / lastTR) * 100 : null,
    minusDI: lastTR > 0 ? (mS[mS.length - 1] / lastTR) * 100 : null,
  };
}

/** Pendiente de una regresión lineal simple sobre la serie normalizada, por día. */
function slope(values, n) {
  if (!Array.isArray(values) || values.length < n) return null;
  const y = values.slice(-n);
  const m = y.length;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (let i = 0; i < m; i++) {
    sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i];
  }
  const den = m * sxx - sx * sx;
  if (!den) return null;
  return (m * sxy - sx * sy) / den;
}

/** Fracción de la serie que queda por debajo (o igual) de x ∈ [0, 1]. */
function percentileSeries(values, x) {
  if (!Array.isArray(values) || !values.length) return null;
  let below = 0;
  for (const v of values) if (v <= x) below++;
  return below / values.length;
}

module.exports = { sma, stdev, rsi, logReturns, atr, adx, slope, percentileSeries, clampi };
