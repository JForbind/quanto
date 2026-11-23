'use strict';
// Humo de la interfaz: arranca Quanto en modo demo, entra y recorre las diez
// vistas a 1440 y 390 px buscando excepciones de JavaScript y desbordes.
//
// Uso:  node tests/ui/smoke.js            (necesita Playwright instalado)
//       npm run test:ui
//
// No toca producción: usa un DATA_DIR temporal y un puerto propio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.SMOKE_PORT) || 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Humo-A1b2c3d4!';
const USER = 'smoke';
const VIEWS = ['dashboard', 'coins', 'market', 'operations', 'tax', 'alerts', 'plans', 'trade', 'sim', 'news', 'settings'];

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Falta Playwright:  npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}


/** Navega como un usuario: barra lateral, barra inferior o hoja «Más». */
async function irA(page, view, esMovil) {
  const candidatos = page.locator(`[data-view="${view}"]`);
  const n = await candidatos.count();
  for (let i = 0; i < n; i++) {
    const el = candidatos.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 5000, force: true });
      return;
    }
  }
  // Ajustes tiene su propio botón en la cabecera de escritorio.
  if (view === 'settings') {
    const btn = page.locator('#settings-btn');
    if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 5000, force: true }); return; }
  }
  // En móvil, las secciones que no caben están en la hoja «Más».
  await page.click('#more-btn', { timeout: 5000, force: true });
  await page.waitForTimeout(250);
  await page.click(`#more-sheet [data-view="${view}"]`, { timeout: 5000, force: true });
}

function waitFor(url, ms = 40000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch { /* aún no */ }
      if (Date.now() > end) return reject(new Error('El servidor no arrancó a tiempo'));
      setTimeout(tick, 400);
    };
    tick();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanto-smoke-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), SNAP_INTERVAL_MIN: '60' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });

  const fallos = [];
  let browser;
  try {
    await waitFor(`${BASE}/api/health`);
    // La primera cuenta es el admin, y en modo admin la app no monta el menú
    // habitual: se crea un usuario normal y se activa por invitación.
    const setup = await fetch(`${BASE}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin-smoke', password: PASSWORD, email: 'admin@example.com', canData: true }),
    });
    if (!setup.ok) throw new Error('No se pudo crear el administrador: ' + (await setup.text()));
    const cookieAdmin = (setup.headers.getSetCookie() || []).map(c => c.split(';')[0]).join('; ');

    const creado = await fetch(`${BASE}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieAdmin },
      body: JSON.stringify({ username: USER }),
    });
    const datos = await creado.json().catch(() => ({}));
    if (!creado.ok || !datos.inviteToken) throw new Error('No se pudo crear el usuario de prueba: ' + JSON.stringify(datos));

    const activado = await fetch(`${BASE}/api/invite/${datos.inviteToken}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    if (!activado.ok) throw new Error('No se pudo activar el usuario: ' + (await activado.text()));

    browser = await chromium.launch();
    for (const [nombre, width, height] of [['escritorio', 1440, 1000], ['móvil', 390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width, height } });
      const page = await ctx.newPage();
      const errores = [];
      page.on('pageerror', e => errores.push(e.message));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-user', { timeout: 20000 });
      await page.fill('#login-user', USER);
      await page.fill('#login-pass', PASSWORD);
      await page.click('#login-btn');
      await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 });
      await page.waitForTimeout(1500);

      for (const view of VIEWS) {
        const antes = errores.length;
        try {
          await irA(page, view, nombre === 'móvil');
        } catch (e) {
          fallos.push(`${nombre} · ${view}: no se pudo abrir (${String(e.message).split('\n')[0]})`);
          continue;
        }
        await page.waitForTimeout(900);
        const visible = await page.evaluate(v => {
          const el = document.querySelector('#view-' + v);
          return !!el && !el.classList.contains('hidden');
        }, view);
        const desborde = await page.evaluate(() => {
          const doc = document.scrollingElement || document.documentElement;
          return Math.max(0, doc.scrollWidth - window.innerWidth);
        });
        if (!visible) fallos.push(`${nombre} · ${view}: la vista no se muestra`);
        if (desborde > 2) {
          const quien = await page.evaluate(() => {
            const ancho = window.innerWidth;
            const fuera = [];
            document.querySelectorAll('*').forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > ancho + 1) {
                const cls = String(el.className || '').slice(0, 24);
                fuera.push(`${el.tagName}${el.id ? '#' + el.id : ''}.${cls}`);
              }
            });
            return [...new Set(fuera)].slice(0, 3).join(' | ');
          });
          fallos.push(`${nombre} · ${view}: desborde de ${desborde}px (${quien})`);
        }
        if (errores.length > antes) fallos.push(`${nombre} · ${view}: ${errores[antes]}`);
      }

      // Las APIs deben responder por código, no por una referencia rota:
      // un refactor que se lleve un endpoint o una función tiene que cantar aquí.
      const APIs = ['/api/overview', '/api/backups', '/api/regime-watch', '/api/coherence', '/api/twr?days=30', '/api/news', '/api/leverage', '/api/plans', '/api/alerts', '/api/transactions', '/api/tax?year=all'];
      for (const url of APIs) {
        const res = await page.evaluate(async u => {
          const r = await fetch(u, { credentials: 'same-origin' });
          const t = await r.text();
          return { status: r.status, body: t.slice(0, 400) };
        }, url);
        if (res.status >= 500 || /is not defined|is not a function|Cannot read propert/.test(res.body)) {
          fallos.push(`${nombre} · ${url}: ${res.status} ${res.body.slice(0, 90)}`);
        }
      }

      // el cajón de noticias y el simulador cargan datos: se les da un respiro
      await page.waitForTimeout(1200);
      if (errores.length > 0) {
        for (const e of errores) fallos.push(`${nombre} · error JS: ${e}`);
      }
      await ctx.close();
    }
  } catch (e) {
    fallos.push('Excepción: ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  if (fallos.length) {
    console.error(`\n${fallos.length} problema(s):`);
    for (const f of Array.from(new Set(fallos))) console.error(' - ' + f);
    if (process.env.SMOKE_DEBUG) console.error('\n--- log del servidor ---\n' + log.slice(-3000));
    process.exit(1);
  }
  console.log(`OK: ${VIEWS.length} vistas a 1440 y 390 px, sin excepciones ni desbordes.`);
})();
