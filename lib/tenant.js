'use strict';
// Contexto multi-usuario: un espacio de datos y un cliente por usuario,
// resuelto con AsyncLocalStorage para no reescribir todo el servidor.
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { BitvavoClient } = require('./bitvavo');
const { readJson, ensureDir } = require('./store');

function baseState() {
  return {
    mode: 'demo',
    ops: [],
    meta: { importedAt: null, autoCaptured: 0, lastSyncAt: null, source: null },
    analysis: null,
    portfolio: null,
    portfolioAt: 0,
    error: null,
    keysError: null,
    syncing: false,
    snapshots: [],
    prices: {},
    evolutionCache: { at: 0, day: '', data: null },
  };
}

function createTenant({ dataDir, userStore, loadOps, applyKeys }) {
  const als = new AsyncLocalStorage();
  const states = new Map();
  const clients = new Map();

  function userFiles(id) {
    const dir = id ? userStore.userDir(id) : dataDir;
    ensureDir(dir);
    return {
      dir,
      ops: path.join(dir, 'bitvavo-history.json'),
      history: path.join(dir, 'history.json'),
      holdings: path.join(dir, 'holdings.json'),
      overrides: path.join(dir, 'overrides.json'),
      settings: path.join(dir, 'settings.json'),
      alerts: path.join(dir, 'alerts.json'),
      plans: path.join(dir, 'plans.json'),
    };
  }

  const DEFAULT = { userId: null, files: userFiles(null), state: baseState() };

  function ctx() {
    return als.getStore() || DEFAULT;
  }

  function current(userId) {
    if (!userId) return DEFAULT;
    if (!states.has(userId)) {
      const state = baseState();
      const entry = { userId, files: userFiles(userId), state };
      states.set(userId, entry);
      als.run(entry, () => {
        try { if (typeof loadOps === 'function') loadOps(); } catch (e) { console.error('[tenant] loadOps:', e.message); }
        try { if (typeof applyKeys === 'function') applyKeys(); } catch (e) { console.error('[tenant] applyKeys:', e.message); }
      });
    }
    return states.get(userId);
  }

  function run(userOrId, fn) {
    const userId = typeof userOrId === 'string' ? userOrId : (userOrId && userOrId.id);
    const entry = current(userId);
    return als.run(entry, fn);
  }

  /** Cliente de Bitvavo del usuario actual, reconstruido si cambian sus claves. */
  function client() {
    const userId = ctx().userId;
    const settings = readJson(ctx().files.settings, {}) || {};
    const key = settings.keysCleared ? '' : (settings.apiKey || '').trim();
    const secret = settings.keysCleared ? '' : (settings.apiSecret || '').trim();
    const sig = `${key}|${secret}`;
    const cacheKey = userId || '__default__';
    let entry = clients.get(cacheKey);
    if (!entry || entry.sig !== sig) {
      entry = { sig, instance: new BitvavoClient({ key, secret }) };
      clients.set(cacheKey, entry);
    }
    return entry.instance;
  }

  /** Proxy para que `client.algo()` siga funcionando sin cambios en el resto del código. */
  const clientProxy = new Proxy({}, {
    get(_t, prop) {
      const instance = client();
      const value = instance[prop];
      return typeof value === 'function' ? value.bind(instance) : value;
    },
  });

  const FILES = new Proxy({}, { get: (_t, key) => ctx().files[key] });
  const state = new Proxy({}, {
    get: (_t, key) => ctx().state[key],
    set: (_t, key, value) => { ctx().state[key] = value; return true; },
    has: (_t, key) => key in ctx().state,
  });

  /** Recorre los usuarios con datos (rol usuario y activos). */
  function forEachUser(fn) {
    for (const user of userStore.list()) {
      if (user.role !== 'user' || user.active === false) continue;
      try {
        run(user, () => fn(user));
      } catch (e) {
        console.error('[tenant] usuario', user.username, e.message);
      }
    }
  }

  function forget(userId) {
    states.delete(userId);
    clients.delete(userId);
  }

  return { ctx, run, current, client: clientProxy, FILES, state, userFiles, forEachUser, forget, baseState };
}

module.exports = { createTenant, baseState };
