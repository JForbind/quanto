'use strict';
// Noticias por RSS: descarga, limpieza y puntuación por relevancia.
const SOURCES = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
];

const MACRO = [
  'fed', 'federal reserve', 'powell', 'sec', 'etf', 'cpi', 'inflación', 'inflation',
  'tipos', 'interest rate', 'tesoro', 'treasury', 'liquidación', 'liquidation',
  'hack', 'exploit', 'regulación', 'regulation', 'blackrock', 'ballenas', 'whale',
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
    /\[\u2026\]$/,
  ];
  for (const c of cuts) out = out.replace(c, '');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > 220) out = out.slice(0, 217).replace(/\s+\S*$/, '') + '…';
  return out;
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
    const summary = cleanSummary(decode(tag(b, 'description') || tag(b, 'summary') || ''));
    out.push({ title, link, ts, summary, source: source.name });
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

async function getNews({ coins = [], limit = 40 } = {}) {
  const results = await Promise.allSettled(SOURCES.map(s => fetchFeed(s)));
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
  return {
    at: Date.now(),
    failed,
    total: scored.length,
    items: scored.slice(0, limit),
  };
}

module.exports = { getNews, SOURCES };
