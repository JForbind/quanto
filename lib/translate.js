'use strict';
// Traducción EN→ES de titulares con caché en disco y dos proveedores gratuitos:
// Google (gtx, mejor calidad) y MyMemory (respaldo). Si ambos fallan, queda el inglés.
const crypto = require('crypto');
const path = require('path');
const { ensureDir, readJson, writeJson } = require('./store');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'news-i18n.json');

const MAX_BYTES = 480;          // límite habitual de estos servicios por consulta
const CONCURRENCY = 4;
const MAX_ENTRIES = 4000;       // titulares guardados antes de purgar los más viejos
const BUDGET = 80;              // cadenas nuevas por tanda
const UA = 'Quanto/1.0 (+https://github.com/JForbind/quanto)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

let mem = null;                 // { map, blockedUntil, dirty }
let timer = null;
const down = { google: 0, mymemory: 0 };   // proveedor castigado hasta esta hora

function load() {
  if (mem) return mem;
  const raw = readJson(FILE, null);
  const data = (raw && typeof raw === 'object') ? raw : {};
  mem = {
    map: (data.map && typeof data.map === 'object') ? data.map : {},
    blockedUntil: Number(data.blockedUntil) || 0,
    dirty: false,
  };
  return mem;
}

function save(force) {
  const m = load();
  if (!m.dirty && !force) return;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const keys = Object.keys(m.map);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete m.map[k];
    }
    ensureDir(DATA_DIR);
    writeJson(FILE, { v: 1, at: Date.now(), map: m.map });
    m.dirty = false;
  }, 1500);
  if (timer.unref) timer.unref();
}

function hash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function clean(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/** Traducción ya guardada para un texto, o null. */
function cached(text) {
  const s = clean(text);
  if (!s) return null;
  return load().map[hash(s)] || null;
}

function clip(text) {
  let q = text;
  if (Buffer.byteLength(q, 'utf8') > MAX_BYTES) {
    q = q.slice(0, MAX_BYTES);
    q = q.slice(0, Math.max(0, q.lastIndexOf(' ')));
  }
  return q;
}

/** Descarta respuestas inservibles (vacías, avisos, o idénticas al original). */
function valid(out, original) {
  if (typeof out !== 'string') return null;
  const t = clean(out);
  if (!t || t.length < 2) return null;
  if (/MYMEMORY WARNING|NO QUERY SPECIFIED|QUERY LENGTH LIMIT|PLEASE SELECT TWO DISTINCT LANGUAGES/i.test(t)) return null;
  if (t.toLowerCase() === clean(original).toLowerCase()) return null;
  return t;
}

async function askGoogle(text, from, to) {
  if (Date.now() < down.google) return null;
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t' +
    '&sl=' + encodeURIComponent(from) + '&tl=' + encodeURIComponent(to) +
    '&q=' + encodeURIComponent(text);
  const r = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
  });
  if (r.status === 429 || r.status === 403) { down.google = Date.now() + 30 * 60e3; return null; }
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  if (!Array.isArray(d) || !Array.isArray(d[0])) return null;
  const out = d[0].map(seg => (seg && seg[0]) || '').join('');
  return valid(out, text);
}

async function askMyMemory(text, from, to) {
  if (Date.now() < down.mymemory) return null;
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
    '&langpair=' + encodeURIComponent(from + '|' + to);
  const r = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  if (!d) return null;
  const raw = d && d.responseData && d.responseData.translatedText;
  const t = valid(raw, text);
  if (!t && /MYMEMORY WARNING/i.test(String(raw || ''))) down.mymemory = Date.now() + 6 * 3600e3;
  return t;
}

async function ask(text, from, to) {
  const q = clip(text);
  if (!q) return null;
  for (const fn of [askGoogle, askMyMemory]) {
    try {
      const out = await fn(q, from, to);
      if (out) return out;
    } catch { /* siguiente proveedor */ }
  }
  return null;
}

/**
 * Traduce una lista de cadenas (en paralelo y con tope) reutilizando la caché.
 * Devuelve un Map { original → traducción } solo con las que se han podido traducir.
 */
async function translateMany(texts, { from = 'en', to = 'es', budget = BUDGET } = {}) {
  const m = load();
  const out = new Map();
  if (Date.now() < m.blockedUntil) return out;

  const pending = [];
  const seen = new Set();
  for (const t of texts) {
    const s = clean(t);
    if (!s) continue;
    const k = hash(s);
    if (m.map[k]) { out.set(t, m.map[k]); continue; }
    if (seen.has(k) || pending.length >= budget) continue;
    seen.add(k);
    pending.push(s);
  }
  if (!pending.length) return out;

  let i = 0;
  const worker = async () => {
    while (i < pending.length) {
      const s = pending[i++];
      const tr = await ask(s, from, to).catch(() => null);
      if (tr) {
        out.set(s, tr);
        m.map[hash(s)] = tr;
        m.dirty = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  save();
  return out;
}

/** Aplica a las noticias las traducciones que ya están en caché (no espera a nadie). */
function decorate(items) {
  const list = Array.isArray(items) ? items : [];
  let pending = 0;
  for (const it of list) {
    if (!it || !it.lang || it.lang === 'es') continue;
    if (it.translated) continue;
    const t = cached(it.title);
    if (t) { it.titleEn = it.title; it.title = t; it.translated = true; }
    else pending++;
    if (it.summary) {
      const s = cached(it.summary);
      if (s) { it.summaryEn = it.summary; it.summary = s; }
    }
  }
  return { items: list, pending };
}

/** Traduce título y resumen de las noticias en inglés, en sitio (bloqueante). */
async function translateItems(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const en = list.filter(it => it && it.lang && it.lang !== 'es' && !it.translated);
  if (!en.length) return list;
  const texts = [];
  for (const it of en) {
    if (it.title) texts.push(it.title);
    if (it.summary) texts.push(it.summary);
  }
  const map = await translateMany(texts, opts);
  for (const it of en) {
    const t = map.get(it.title);
    if (t) { it.titleEn = it.title; it.title = t; it.translated = true; }
    if (it.summary) {
      const s = map.get(it.summary);
      if (s) { it.summaryEn = it.summary; it.summary = s; }
    }
  }
  return list;
}

module.exports = { translateMany, translateItems, decorate, cached, FILE };
