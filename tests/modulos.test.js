'use strict';
// Comprueba que los módulos del front importen los símbolos compartidos que usan.
// Es el fallo que tumbó la carga de la app al extraer Fiscal: un `$$` o `priceFmt`
// sin importar lanza ReferenceError al importar el módulo y la app no arranca;
// Vite no lo detecta porque en ESM un identificador suelto se lee como global.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', 'public', 'src');

// Símbolos que viven en módulos compartidos y por tanto hay que importar.
const COMPARTIDOS = [
  '$', '$$', 'state', 'charts', 'api', 'toast', 'eur', 'eur0', 'num', 'pct', 'priceFmt',
  'esc', 'signed', 'arrow', 'dateShort', 'dateLong', 'dateTime', 'relTime', 'groupNum', 'short', 'eurFmt', 'eur0Fmt', 'loadCoinIcons',
  'coinBadge', 'coinRow', 'sparklineSvg', 'coinColor', 'PIE_COLORS', 'loadCoinIcons',
  'chart', 'themeVars', 'baseTooltip', 'hexA', 'openModal', 'closeModal',
  'RANGES', 'loadRanges', 'rangeFmt',
  'renderDashboard', 'renderSharedKpis', 'rangeCut', 'renderEvolutionChart', 'renderAllocation', 'loadRadar',
  'loadEvolution', 'renderSimBuy', 'rngBlock', 'sparklineWide', 'loadFearGreed', 'loadHistory', 'loadSparklines', 'watchRender',
];

function ficheros(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ficheros(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function limpiar(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

function importadosYDeclarados(src) {
  const nombres = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const n of m[1].split(',')) {
      const name = n.trim().split(/\s+as\s+/).pop().trim();
      if (name) nombres.add(name);
    }
  }
  for (const m of src.matchAll(/import\s+([a-zA-Z_$][\w$]*)\s+from/g)) nombres.add(m[1]);
  for (const m of src.matchAll(/function\s+([a-zA-Z_$][\w$]*)/g)) nombres.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)/g)) nombres.add(m[1]);
  for (const m of src.matchAll(/class\s+([a-zA-Z_$][\w$]*)/g)) nombres.add(m[1]);
  return nombres;
}

test('cada módulo importa los símbolos compartidos que usa', () => {
  const problemas = [];
  for (const f of ficheros(RAIZ)) {
    const src = limpiar(fs.readFileSync(f, 'utf8'));
    const propios = importadosYDeclarados(src);
    // las rutas de import (./charts.js) no son usos del símbolo
    const cuerpo = src.split('\n').filter(l => !/^\s*import\b/.test(l)).join('\n');
    for (const sym of COMPARTIDOS) {
      if (propios.has(sym)) continue;
      const esc = sym.replace(/\$/g, '\\$');
      const uso = new RegExp(`(?<![.\\w$])${esc}\\s*[.(]`);
      if (uso.test(cuerpo)) {
        problemas.push(`${path.relative(RAIZ, f)}: usa «${sym}» sin importarlo`);
      }
    }
  }
  assert.deepStrictEqual(problemas, []);
});

test('app.js importa todo lo que usa de los módulos', () => {
  const RUTA_APP = path.join(__dirname, '..', 'public', 'app.js');
  const exportados = new Set();
  for (const f of ficheros(RAIZ)) {
    const src = limpiar(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([\w$]+)/g)) exportados.add(m[1]);
    for (const m of src.matchAll(/export\s+(?:const|let)\s+([\w$]+)/g)) exportados.add(m[1]);
  }
  const app = limpiar(fs.readFileSync(RUTA_APP, 'utf8'));
  const importados = importadosYDeclarados(app);
  const usados = new Set();
  for (const m of app.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) usados.add(m[1]);
  const faltan = [...(usados)].filter(n => exportados.has(n) && !importados.has(n)).sort();
  assert.deepStrictEqual(faltan, [], 'app.js usa funciones de módulos sin importarlas: ' + faltan.join(', '));
});
