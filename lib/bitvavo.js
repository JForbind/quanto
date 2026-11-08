'use strict';
// Cliente de la API de Bitvavo v2 (REST).
// Endpoints públicos: /time /markets /assets /ticker/price /ticker/24h /{market}/candles
// Endpoints privados: /balance /account /account/history /trades /depositHistory /withdrawalHistory
const crypto = require('crypto');

const BASE = 'https://api.bitvavo.com/v2';
const TIMEOUT = 20000;

class BitvavoError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BitvavoError';
    this.status = status;
  }
}

class BitvavoClient {
  constructor({ key = '', secret = '' } = {}) {
    this.key = key || '';
    this.secret = secret || '';
    this._offset = undefined;
    this._cache = new Map();
  }

  get configured() {
    return !!(this.key && this.secret);
  }

  setKeys(key, secret) {
    this.key = key || '';
    this.secret = secret || '';
    this._offset = undefined;
    this._cache.clear();
  }

  async request(method, path, { auth = false, body = null, retry = 1 } = {}) {
    const url = BASE + path;
    const headers = { Accept: 'application/json', 'User-Agent': 'quanto/2.0' };
    let payload = '';
    if (body !== null) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (auth) {
      if (!this.configured) throw new BitvavoError('Faltan las claves de Bitvavo', 401);
      const timestamp = await this.now();
      const signedPath = '/v2' + path;
      headers['Bitvavo-Access-Key'] = this.key;
      headers['Bitvavo-Access-Timestamp'] = String(timestamp);
      headers['Bitvavo-Access-Window'] = '10000';
      headers['Bitvavo-Access-Signature'] = crypto
        .createHmac('sha256', this.secret)
        .update(timestamp + method + signedPath + payload)
        .digest('hex');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : payload || undefined,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (retry > 0) return this.request(method, path, { auth, body, retry: retry - 1 });
      throw new BitvavoError('No se pudo conectar con Bitvavo: ' + (e.name === 'AbortError' ? 'tiempo agotado' : e.message), 0);
    }
    clearTimeout(timer);

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || (typeof data === 'string' ? data : '') || res.statusText;
      if (retry > 0 && (res.status >= 500 || res.status === 429)) {
        await new Promise(r => setTimeout(r, 700));
        return this.request(method, path, { auth, body, retry: retry - 1 });
      }
      throw new BitvavoError(`Bitvavo ${res.status}: ${String(msg).slice(0, 180)}`, res.status);
    }
    return data;
  }

  async now() {
    if (this._offset === undefined) {
      try {
        const t = await this.request('GET', '/time');
        this._offset = t && t.time ? t.time - Date.now() : 0;
      } catch {
        this._offset = 0;
      }
    }
    return Date.now() + this._offset;
  }

  cached(key, ttl, fn) {
    const hit = this._cache.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    const v = fn();
    this._cache.set(key, { t: Date.now(), v });
    return v;
  }

  // ---------- público ----------
  tickerPrice(market = '') {
    const q = market ? `?market=${encodeURIComponent(market)}` : '';
    return this.cached('price:' + market, 30e3, () => this.request('GET', '/ticker/price' + q));
  }

  ticker24h(market = '') {
    const q = market ? `?market=${encodeURIComponent(market)}` : '';
    return this.cached('24h:' + market, 60e3, () => this.request('GET', '/ticker/24h' + q));
  }

  markets() {
    return this.cached('markets', 6 * 3600e3, () => this.request('GET', '/markets'));
  }

  candles(market, interval = '1d', limit = 500) {
    const q = `?interval=${encodeURIComponent(interval)}&limit=${Math.min(Number(limit) || 500, 1000)}`;
    return this.cached(`candles:${market}:${interval}:${limit}`, 60e3, () => this.request('GET', `/${encodeURIComponent(market)}/candles${q}`));
  }

  // ---------- privado ----------
  balance() { return this.request('GET', '/balance', { auth: true }); }
  account() { return this.request('GET', '/account', { auth: true }); }

  accountHistory(maxItems = 100) {
    const n = Math.max(1, Math.min(100, Number(maxItems) || 100));
    return this.request('GET', `/account/history?page=1&maxItems=${n}`, { auth: true });
  }

  trades(market = '') {
    const q = market ? `?market=${encodeURIComponent(market)}` : '';
    return this.request('GET', '/trades' + q, { auth: true });
  }
}

module.exports = { BitvavoClient, BitvavoError };
