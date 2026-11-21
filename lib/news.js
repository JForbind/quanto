'use strict';
// Noticias por RSS: descarga, limpieza, traducción y puntuación por relevancia.
// Fuentes en español nativo + fuentes en inglés que se traducen al vuelo.
const { translateItems, decorate } = require('./translate');

const SOURCES = [
  { name: 'Criptonoticias', url: 'https://www.criptonoticias.com/feed/', lang: 'es' },
  { name: 'BeInCrypto ES', url: 'https://es.beincrypto.com/feed/', lang: 'es' },
  { name: 'DiarioBitcoin', url: 'https://www.diariobitcoin.com/feed/', lang: 'es' },
  { name: 'CriptoTendencia', url: 'https://www.criptotendencia.com/feed/', lang: 'es' },
  { name: 'Investing.com', url: 'https://es.investing.com/rss/news_301.rss', lang: 'es' },
  { name: 'CryptoNews ES', url: 'https://cryptonews.com/es/feed/', lang: 'es' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', lang: 'en' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', lang: 'en' },
  { name: 'The Block', url: 'https://www.theblock.co/rss.xml', lang: 'en' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed', lang: 'en' },
  { name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', lang: 'en' },
];

const MACRO = [
  'fed', 'federal reserve', 'powell', 'sec', 'etf', 'cpi', 'inflación', 'inflation',
  'tipos', 'interest rate', 'tesoro', 'treasury', 'liquidación', 'liquidation',
  'hack', 'exploit', 'regulación', 'regulation', 'blackrock', 'ballenas', 'whale',
  'subida de tipos', 'recorte de tipos', 'comisión de bolsa', 'aranceles',
];

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSummary(s) {
  let out = String(s || '');
  const cuts = [
    /read the full story[\s\S]*$/i,
    /understand the crypto stories[\s\S]*$/i,
    /the post .{0,120}appeared first on[\s\S]*$/i,
    /continue reading[\s\S]*$/i,
    /subscribe[\s\S]*$/i,
    /la (?:nota|entrada|publicación) .{0,180}(?:se publicó|se publico|apareció|aparecio) (?:primero )?en[\s\S]*$/i,
    /la (?:nota|entrada|publicación) .{0,180}apareció primero en[\s\S]*$/i,
    /el artículo .{0,180}(?:continúa|continua) en[\s\S]*$/i,
    /sigue leyendo[\s\S]*$/i,
    /leer más[\s\S]*$/i,
    /\[\u2026\]$/,
  ];
  for (const c of cuts) out = out.replace(c, '');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > 220) out = out.slice(0, 217).replace(/\s+\S*$/, '') + '…';
  return out;
}

/** Quita el nombre del medio con el que algunos RSS empiezan el resumen. */
function stripSource(sum, name) {
  if (!sum || !name) return sum;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sum.replace(new RegExp('^' + escaped + '\\s*[:|–-]?\\s*', 'i'), '');
}

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? m[1] : '';
}

function linkOf(block) {
  const plain = tag(block, 'link');
  if (plain && !plain.includes('<')) return decode(plain);
  const href = /<link[^>]*href=["']([^"']+)["']/i.exec(block);
  return href ? href[1] : '';
}

function parseFeed(xml, source) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = decode(tag(b, 'title'));
    const link = linkOf(b);
    if (!title || !link) continue;
    const dateRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
    const ts = Date.parse(decode(dateRaw)) || Date.now();
    const summary = stripSource(cleanSummary(decode(tag(b, 'description') || tag(b, 'summary') || '')), source.name);
    out.push({ title, link, ts, summary, source: source.name, lang: source.lang || 'en' });
  }
  return out;
}

async function fetchFeed(source, ms = 8000) {
  const r = await fetch(source.url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'user-agent': 'Quanto/1.0 (+https://github.com/JForbind/quanto)', accept: 'application/rss+xml, application/xml, text/xml' },
  });
  if (!r.ok) throw new Error(source.name + ' HTTP ' + r.status);
  return parseFeed(await r.text(), source);
}

function scoreItem(item, coins) {
  const text = (item.title + ' ' + item.summary).toLowerCase();
  const hits = [];
  for (const c of coins) {
    const sym = String(c).toLowerCase();
    if (sym.length < 2) continue;
    if (new RegExp(`(^|[^a-z0-9])${sym.replace(/[^a-z0-9]/g, '')}([^a-z0-9]|$)`).test(text)) hits.push(String(c).toUpperCase());
  }
  const macro = MACRO.some(w => text.includes(w));
  let score = hits.length * 3 + (macro ? 2 : 0);
  const ageH = (Date.now() - item.ts) / 3600e3;
  if (ageH < 6) score += 2;
  else if (ageH < 24) score += 1;
  return { ...item, score, coins: [...new Set(hits)], macro };
}

// Cola de traducción en segundo plano: una tanda cada vez, sin frenar la respuesta.
let warmQueue = [];
let warmRunning = false;

function warmTranslations(items) {
  if (!items || !items.length) return;
  warmQueue.push(items);
  if (warmRunning) return;
  warmRunning = true;
  (async () => {
    while (warmQueue.length) {
      const list = warmQueue.shift();
      try { await translateItems(list, { budget: 80 }); } catch {}
    }
  })().catch(() => {}).finally(() => { warmRunning = false; });
}

async function fetchAll() {
  const results = await Promise.allSettled(SOURCES.map(s => fetchFeed(s)));
  // Si fallan varias fuentes de golpe (red o límite temporal), se reintentan una vez.
  const retry = [];
  results.forEach((r, i) => { if (r.status === 'rejected') retry.push(i); });
  if (retry.length >= 3) {
    await new Promise(r => setTimeout(r, 700));
    const again = await Promise.allSettled(retry.map(i => fetchFeed(SOURCES[i])));
    again.forEach((r, k) => { if (r.status === 'fulfilled') results[retry[k]] = r; });
  }
  return results;
}

async function getNews({ coins = [], limit = 40 } = {}) {
  const results = await fetchAll();
  const items = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else failed.push(SOURCES[i].name);
  });

  // Sin duplicados por titular
  const seen = new Set();
  const unique = items.filter(it => {
    const key = it.title.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, '').slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const scored = unique.map(it => scoreItem(it, coins)).sort((a, b) => b.score - a.score || b.ts - a.ts);
  const page = scored.slice(0, limit);
  // Las fuentes inglesas se traducen: lo ya traducido se sirve al instante y el
  // resto se completa en segundo plano (la vista lo repide a los pocos segundos).
  const { pending } = decorate(page);
  if (pending) warmTranslations(page);
  return {
    at: Date.now(),
    failed,
    total: scored.length,
    pending,
    items: page,
  };
}

module.exports = { getNews, SOURCES };
