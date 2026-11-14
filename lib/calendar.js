'use strict';
// Calendario macro: próximas publicaciones de FRED (IPC, empleo, PIB, PCE, PPI, ventas).
const RELEASES = [
  { id: 10, name: 'IPC (inflación EE. UU.)', short: 'IPC' },
  { id: 50, name: 'Informe de empleo', short: 'Empleo' },
  { id: 46, name: 'Precios al productor (PPI)', short: 'PPI' },
  { id: 9, name: 'Ventas minoristas', short: 'Ventas' },
  { id: 54, name: 'Renta y consumo (PCE)', short: 'PCE' },
  { id: 53, name: 'PIB de EE. UU.', short: 'PIB' },
];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url, ms = 9000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Quanto/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function getCalendar(apiKey) {
  if (!apiKey) return { configured: false, items: [] };
  const from = new Date();
  const to = new Date(Date.now() + 60 * 86400e3);
  const results = await Promise.allSettled(RELEASES.map(rel => {
    const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${rel.id}` +
      `&api_key=${encodeURIComponent(apiKey)}&file_type=json` +
      `&realtime_start=${ymd(from)}&realtime_end=${ymd(to)}` +
      `&include_release_dates_with_no_data=true&sort_order=asc`;
    return fetchJson(url).then(d => ({ rel, dates: (d.release_dates || []).map(x => x.date) }));
  }));

  const items = [];
  const failed = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') { failed.push(true); continue; }
    for (const date of r.value.dates) {
      const t = Date.parse(date + 'T14:30:00Z');
      if (!isFinite(t)) continue;
      items.push({ date, ts: t, name: r.value.rel.name, short: r.value.rel.short });
    }
  }
  items.sort((a, b) => a.ts - b.ts);

  // Fuera duplicados del mismo día y misma publicación
  const seen = new Set();
  const unique = items.filter(it => {
    const k = it.short + it.date;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    configured: true,
    at: Date.now(),
    failedCount: failed.length,
    items: unique.slice(0, 12).map(it => {
      const days = Math.round((Date.parse(it.date + 'T00:00:00Z') - Date.parse(ymd(new Date()) + 'T00:00:00Z')) / 86400e3);
      return { ...it, days };
    }),
  };
}

module.exports = { getCalendar, RELEASES };
