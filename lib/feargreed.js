'use strict';
// Índice Miedo y Codicia (Crypto Fear & Greed) de alternative.me.
// Se cachea 1 hora en memoria y se guarda en disco para poder mostrarlo sin red.
const { readJson, writeJson } = require('./store');

const SOURCE = 'https://api.alternative.me/fng/?limit=0&format=json';
const TTL = 60 * 60 * 1000;

const cache = { at: 0, value: null, error: null };

const LABELS = [
  { max: 24, key: 'extreme-fear', text: 'Miedo extremo' },
  { max: 44, key: 'fear', text: 'Miedo' },
  { max: 55, key: 'neutral', text: 'Neutral' },
  { max: 75, key: 'greed', text: 'Codicia' },
  { max: 100, key: 'extreme-greed', text: 'Codicia extrema' },
];

function classify(value) {
  const hit = LABELS.find(l => value <= l.max) || LABELS[LABELS.length - 1];
  return { key: hit.key, text: hit.text };
}

function normalize(raw) {
  const rows = Array.isArray(raw && raw.data) ? raw.data : [];
  const series = rows
    .map(r => ({
      t: Number(r.timestamp) * 1000,
      value: Number(r.value),
      label: r.value_classification || classify(Number(r.value)).text,
    }))
    .filter(r => isFinite(r.t) && isFinite(r.value))
    .sort((a, b) => a.t - b.t);
  if (!series.length) return null;
  const last = series[series.length - 1];
  const week = series[series.length - 8];
  const month = series[series.length - 31];
  return {
    value: last.value,
    label: last.label,
    classification: classify(last.value),
    ts: last.t,
    weekAgo: week ? week.value : null,
    monthAgo: month ? month.value : null,
    series,
    source: 'alternative.me',
    updatedAt: Date.now(),
  };
}

async function getFearGreed(dataDir) {
  const file = require('path').join(dataDir, 'feargreed.json');
  const now = Date.now();
  if (cache.value && now - cache.at < TTL) return { ...cache.value, stale: false, cached: true };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(SOURCE, { headers: { Accept: 'application/json', 'User-Agent': 'quanto/2.0' }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const data = normalize(json);
    if (!data) throw new Error('respuesta vacía');
    cache.at = now;
    cache.value = data;
    cache.error = null;
    writeJson(file, data);
    return { ...data, stale: false, cached: false };
  } catch (e) {
    cache.error = e.message;
    const disk = readJson(file, null);
    if (disk && Array.isArray(disk.series) && disk.series.length) {
      return { ...disk, stale: true, cached: true, error: e.message };
    }
    return { value: null, series: [], error: e.message, stale: true, cached: false };
  }
}

module.exports = { getFearGreed, classify, LABELS };
