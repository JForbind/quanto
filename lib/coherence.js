'use strict';
// Informe semanal de coherencia: junta régimen, desviación del reparto por riesgo
// y rentabilidad frente a BTC en un texto que se pueda leer en el móvil.

const TREND = { alcista: 'alcista', bajista: 'bajista', lateral: 'sin dirección' };

function pct(v, d = 1) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + (v * 100).toFixed(d).replace('.', ',') + ' %';
}

function pp(v) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', ',') + ' pp';
}

function money(v) {
  if (v == null || !isFinite(v)) return '—';
  // formato propio: no depende del ICU que traiga Node
  const n = Math.round(Math.abs(v));
  const grupos = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '-' : '') + grupos + ' €';
}

function fecha(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

/**
 * @param {{regimes:Array, sizing:Object|null, twr:Object|null, total:number, now:number}} input
 */
function build({ regimes, sizing, twr, total, now = Date.now() } = {}) {
  const lista = Array.isArray(regimes) ? regimes : [];
  const lineas = [];
  const avisos = [];

  for (const r of lista) {
    if (!r || !r.ok) continue;
    lineas.push(`• ${r.symbol}: ${TREND[r.trend] || r.trend}${r.volState ? ', volatilidad ' + r.volState : ''}${r.volPercentile != null ? ` (percentil ${Math.round(r.volPercentile * 100)})` : ''}`);
    if (r.volState === 'alta') avisos.push(`${r.symbol} está en volatilidad alta`);
  }

  const desviaciones = [];
  if (sizing && sizing.ok && Array.isArray(sizing.rows)) {
    for (const row of sizing.rows) {
      if (row.cash) continue;
      const d = row.current - row.target;
      if (Math.abs(d) >= 0.10) desviaciones.push({ ...row, d });
    }
    desviaciones.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    for (const row of desviaciones.slice(0, 4)) {
      const euros = row.value * (row.target / (row.current || 1) - 1);
      avisos.push(`${row.symbol}: ${(row.current * 100).toFixed(0)} % de la cartera, ${Math.abs(row.target * 100 - row.current * 100).toFixed(0)} pp ${row.target > row.current ? 'por debajo' : 'por encima'} del reparto por riesgo${euros < 0 ? ` (sobran ~${money(Math.abs(euros))})` : ''}`);
    }
    if (sizing.portfolioVol != null && sizing.portfolioVolNow != null && sizing.portfolioVolNow > sizing.portfolioVol * 1.15) {
      avisos.push(`Tu volatilidad actual (${Math.round(sizing.portfolioVolNow * 100)} %) está por encima de la del reparto sugerido (${Math.round(sizing.portfolioVol * 100)} %)`);
    }
  }

  const clases = ['up', 'down', 'flat'];
  const toneDiff = twr && twr.diff != null ? (twr.diff > 0 ? 'up' : twr.diff < 0 ? 'down' : 'flat') : 'flat';
  const secciones = [];
  if (lista.length) secciones.push({ title: 'Régimen', lines: lineas });
  if (twr && twr.ok) {
    secciones.push({
      title: 'Rentabilidad',
      lines: [
        `• Tu TWR: ${pct(twr.total)}${twr.days ? ` en ${twr.days} días` : ''}`,
        `• Mantener BTC: ${pct(twr.benchmark)}`,
        `• Diferencia: ${pp(twr.diff)} ${twr.diff != null ? (twr.diff >= 0 ? 'por delante' : 'por detrás') : ''}`.trim(),
      ],
    });
  }
  if (desviaciones.length) {
    secciones.push({
      title: 'Reparto por riesgo',
      lines: desviaciones.slice(0, 4).map(row => `• ${row.symbol}: ${(row.current * 100).toFixed(1).replace('.', ',')} % ahora → ${(row.target * 100).toFixed(1).replace('.', ',')} % sugerido`),
    });
  }
  if (avisos.length) secciones.push({ title: 'Qué mirar', lines: avisos.map(a => '• ' + a) });

  const cabecera = `Informe de coherencia · ${fecha(now)}${total ? ' · cartera ' + money(total) : ''}`;
  const text = [cabecera, ''];
  for (const s of secciones) {
    text.push(s.title.toUpperCase());
    text.push(...s.lines);
    text.push('');
  }
  if (!secciones.length) text.push('Sin datos suficientes esta semana.');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto">
    <h2 style="font-size:17px;margin:0 0 4px">Informe de coherencia</h2>
    <p style="color:#6b7a90;font-size:12px;margin:0 0 16px">${fecha(now)}${total ? ' · cartera ' + money(total) : ''}</p>
    ${secciones.map(s => `<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#8a97ab;margin:18px 0 6px">${s.title}</h3>
      <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6;color:#111">${s.lines.map(l => `<li>${l.replace(/^•\s*/, '')}</li>`).join('')}</ul>`).join('')}
    <p style="color:#8a97ab;font-size:11px;margin-top:20px">Generado por Quanto. Es una lectura de tus datos, no una recomendación.</p>
  </div>`;

  return {
    subject: `Quanto · coherencia ${fecha(now)}`,
    text: text.join('\n').trim(),
    html,
    sections: secciones,
    warnings: avisos,
    tone: { diff: toneDiff },
  };
}

module.exports = { build, pct, pp, money };
