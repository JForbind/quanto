'use strict';
// Vigilante de régimen: compara la lectura de hoy con la guardada y decide si
// merece un aviso. Solo cambios de tendencia o de volatilidad; nada de ruido.
// Sin red y sin estado: eso vive en server.js.

/** Resumen compacto de una lectura de régimen (lo que se guarda). */
function summarize(regime, at = Date.now()) {
  if (!regime || !regime.ok) return null;
  return {
    trend: regime.trend || 'lateral',
    strength: regime.strength || null,
    volState: regime.volState || null,
    volPercentile: regime.volPercentile,
    adx: regime.adx ? Number(regime.adx.value) : null,
    vol30: regime.vol30,
    riskMultiplier: regime.riskMultiplier,
    price: regime.price,
    at,
  };
}

const TREND_ES = { alcista: 'alcista', bajista: 'bajista', lateral: 'lateral' };
const VOL_ES = { alta: 'alta', media: 'media', baja: 'baja' };

/**
 * Cambios relevantes entre dos lecturas.
 * @returns {{changed:boolean, reasons:Array<{kind:string,from:string,to:string}>}}
 */
function diff(prev, next) {
  if (!next) return { changed: false, reasons: [] };
  if (!prev) return { changed: true, reasons: [{ kind: 'inicial', from: null, to: next.trend }] };
  const reasons = [];
  if (prev.trend !== next.trend) {
    reasons.push({ kind: 'tendencia', from: prev.trend, to: next.trend });
  }
  if (next.volState && prev.volState !== next.volState) {
    reasons.push({ kind: 'volatilidad', from: prev.volState, to: next.volState });
  }
  return { changed: reasons.length > 0, reasons };
}

function fmtPct(v) {
  return v == null || !isFinite(v) ? null : Math.round(v * 100) + ' %';
}

/** Texto plano para Telegram/email. */
function message(symbol, prev, next, reasons) {
  const lines = [];
  const dir = next.trend === 'alcista' ? '📈' : next.trend === 'bajista' ? '📉' : '➡️';
  lines.push(`${dir} ${symbol}: cambio de régimen`);
  for (const r of reasons) {
    if (r.kind === 'tendencia') {
      lines.push(`Tendencia: ${TREND_ES[r.from] || r.from} → ${TREND_ES[r.to] || r.to}${next.adx != null ? ` (ADX ${next.adx.toFixed(1)}${next.strength ? ', fuerza ' + next.strength : ''})` : ''}`);
    } else if (r.kind === 'volatilidad') {
      const pct = fmtPct(next.volPercentile);
      lines.push(`Volatilidad: ${VOL_ES[r.from] || r.from} → ${VOL_ES[r.to] || r.to}${pct ? ` (percentil ${pct})` : ''}`);
    } else if (r.kind === 'inicial') {
      lines.push(`Primera lectura: ${TREND_ES[next.trend] || next.trend}${next.volState ? ', volatilidad ' + next.volState : ''}`);
    }
  }
  if (prev && prev.riskMultiplier != null && next.riskMultiplier != null && prev.riskMultiplier !== next.riskMultiplier) {
    lines.push(`Tamaño sugerido: ${Math.round(prev.riskMultiplier * 100)} % → ${Math.round(next.riskMultiplier * 100)} % del habitual`);
  }
  if (next.price) lines.push(`Precio: ${next.price}`);
  return lines.join('\n');
}

function subject(symbol, reasons) {
  const kinds = reasons.map(r => r.kind);
  if (kinds.includes('tendencia') && kinds.includes('volatilidad')) return `Quanto · ${symbol}: tendencia y volatilidad`;
  if (kinds.includes('tendencia')) return `Quanto · ${symbol}: cambio de tendencia`;
  if (kinds.includes('volatilidad')) return `Quanto · ${symbol}: cambio de volatilidad`;
  return `Quanto · ${symbol}: régimen`;
}

/** ¿Toca revisar? (intervalo en horas desde la última pasada). */
function due(state, intervalH, now = Date.now()) {
  const last = Number(state && state.at) || 0;
  return !last || now - last >= Math.max(1, Number(intervalH) || 6) * 3600e3;
}

/** ¿Merece aviso? La primera lectura solo siembra el estado, no avisa. */
function shouldNotify(reasons, cooledOk) {
  if (!Array.isArray(reasons) || !reasons.length) return false;
  if (reasons.every(r => r.kind === 'inicial')) return false;
  return !!cooledOk;
}

/** ¿Ha pasado el enfriamiento por moneda? */
function cooled(item, cooldownH, now = Date.now()) {
  const sent = Number(item && item.sentAt) || 0;
  return !sent || now - sent >= Math.max(1, Number(cooldownH) || 12) * 3600e3;
}

module.exports = { summarize, diff, message, subject, due, cooled, shouldNotify };
