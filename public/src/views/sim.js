'use strict';
// Simulador: escenarios de precio, venta simulada, compra extra y guardados.
import { $, state, api, esc, eur, num, pct, priceFmt, dateShort } from '../core.js';
import { RANGES, rangeFmt, athFuente, anioCobertura, avisoExchange } from '../data/ranges.js';

// La app inyecta seguimiento y catálogo de mercados.
let getWatch = () => [];
let getMercados = () => [];
export function initSim(deps = {}) {
  if (typeof deps.getWatch === 'function') getWatch = deps.getWatch;
  if (typeof deps.getMercados === 'function') getMercados = deps.getMercados;
}

// ---------------------------------------------------------------- simulador
const SIM_KEY = 'quanto.sim.escenarios';
export const simState = { symbol: null, price: null, buyAmount: 150, tax: null, taxAt: 0 };

export function simSaved() {
  try { return JSON.parse(localStorage.getItem(SIM_KEY) || '[]'); } catch { return []; }
}
export function simSave(list) { try { localStorage.setItem(SIM_KEY, JSON.stringify(list)); } catch {} }

export function simDefaults() {
  const p = state.portfolio;
  const cartera = ((p && p.coins) || []).filter(c => c.amount > 0);
  const seguidas = getWatch();
  const lista = [...new Set([...cartera.map(c => c.symbol), ...seguidas])];
  if (!lista.length) return;
  if (!simState.symbol || !lista.includes(simState.symbol)) {
    simState.symbol = lista[0];
    const c = simCoinObject(lista[0]);
    simState.price = Number(c.price) || 0;
  }
}

export function simCoinObject(symbol) {
  const p = state.portfolio;
  const enCartera = ((p && p.coins) || []).find(c => c.symbol === symbol);
  if (enCartera) return enCartera;
  // moneda en seguimiento: sin posición, con el precio de mercado
  const m = getMercados().find(x => x.symbol === symbol) || {};
  return {
    symbol,
    amount: 0,
    price: Number(m.price) || 0,
    dayChangePct: m.change === undefined ? null : m.change,
    avgPrice: 0,
    value: 0,
    invested: 0,
    costKnown: false,
    onExchange: 0,
    inCold: 0,
    enCartera: false,
  };
}

export function simNumbers() {
  const p = state.portfolio;
  const coin = simCoinObject(simState.symbol);
  if (!p || !coin) return null;
  const price = Number(simState.price) || 0;
  const cash = Number(p.cash) || 0;
  const cryptoValue = Number(p.totalValue) - cash;
  const newCoinValue = coin.amount * price;
  const newCrypto = cryptoValue - coin.value + newCoinValue;
  const newTotal = newCrypto + cash;
  const delta = newTotal - p.totalValue;
  const newPnl = newCrypto - p.invested;
  const weight = newTotal > 0 ? (newCoinValue / newTotal) * 100 : 0;
  const vsAvg = coin.avgPrice > 0 ? ((price - coin.avgPrice) / coin.avgPrice) * 100 : null;
  return { p, coin, price, cash, cryptoValue, newCoinValue, newCrypto, newTotal, delta, newPnl, weight, vsAvg };
}

export function renderSim() {
  simDefaults();
  const p = state.portfolio;
  const box = $('#sim-coin');
  if (!box || !p) return;

  const cartera = (p.coins || []).filter(c => c.amount > 0).map(c => c.symbol);
  const seguidas = getWatch();
  const lista = [...new Set([...cartera, ...seguidas])].sort();
  box.innerHTML = lista.map(s => {
    const marca = cartera.includes(s) ? '' : ' · seguimiento';
    return `<option value="${esc(s)}"${s === simState.symbol ? ' selected' : ''}>${esc(s)}${marca}</option>`;
  }).join('');
  const priceInput = $('#sim-price');
  if (priceInput && document.activeElement !== priceInput) priceInput.value = simState.price;

  const n = simNumbers();
  if (!n) return;

  const r = RANGES[simState.symbol] || {};
  const base = Number(n.coin.price) || 0;
  // Siempre los mismos nueve botones: los que no aplican salen deshabilitados,
  // así la rejilla no cambia de forma entre monedas en cartera y en seguimiento.
  const tienePosicion = Number(n.coin.amount) > 0;
  const presets = [
    ['Precio actual', base, 'El precio de ahora mismo'],
    ['−50 %', base * 0.5, 'La mitad del precio actual'],
    ['−25 %', base * 0.75, 'Un 25 % por debajo'],
    ['+25 %', base * 1.25, 'Un 25 % por encima'],
    ['+50 %', base * 1.5, 'Un 50 % por encima'],
    ['×2', base * 2, 'El doble del precio actual'],
    ['Tu precio medio', n.coin.avgPrice, tienePosicion ? 'Tu precio medio de compra' : 'Sin posición: no hay precio medio'],
    ['Máximo del año', r.high, 'Precio más alto de este año' + (anioCobertura(r) ? ' (' + anioCobertura(r) + ')' : '')],
    ['Máx. histórico', r.ath, ('Precio más alto de la historia' + (athFuente(r) ? ' · ' + athFuente(r) : ''))],
  ];
  $('#sim-presets').innerHTML = presets.map(([label, value, title]) => {
    const ok = Number(value) > 0;
    if (!ok) {
      return `<button class="btn btn-ghost btn-xs" type="button" disabled title="${esc(title)}">${label}</button>`;
    }
    const activo = Math.abs(value - n.price) <= Math.abs(value) * 0.0005;
    return `<button class="btn btn-ghost btn-xs${activo ? ' is-active' : ''}" type="button" data-sim-price="${value.toFixed(6)}" title="${esc(title)}">${label}</button>`;
  }).join('');

  $('#sim-now').innerHTML = n.coin.amount > 0
    ? `Precio ahora de ${esc(simState.symbol)}: <b>${priceFmt(n.coin.price)}</b> · tu media: <b>${n.coin.costKnown ? priceFmt(n.coin.avgPrice) : 'n/d'}</b> · ${num(n.coin.amount, 8)} ${esc(simState.symbol)}`
    : `Precio ahora de ${esc(simState.symbol)}: <b>${priceFmt(n.coin.price)}</b> · <span class="muted">sin posición (en seguimiento)</span>`;


  if (!(Number(n.coin.amount) > 0)) {
    $('#sim-vender').innerHTML = `<header class="card-head"><div><h2>¿Y si vendo?</h2>
        <p class="card-sub">Sin posición en ${esc(simState.symbol)}</p></div></header>
      <p class="hint" style="margin:0">No tienes ${esc(simState.symbol)} en cartera, así que no hay nada que vender. Prueba la compra simulada de abajo.</p>`;
  } else if (simState.taxAt !== n.price || !simState.tax) {
    simState.tax = null;
    simState.taxAt = n.price;
    api(`/api/tax/simulate?symbol=${encodeURIComponent(simState.symbol)}&amount=${n.coin.amount}&price=${n.price}`)
      .then(d => { simState.tax = d; if (state.view === 'sim') renderSimTax(); })
      .catch(() => {});
  }
  if (Number(n.coin.amount) > 0) {
    $('#sim-vender').innerHTML = `<header class="card-head"><div><h2>¿Y si vendo?</h2><p class="card-sub">Vender toda la posición a ${priceFmt(n.price)}</p></div></header><div id="sim-vender-body" class="sim-lines">Calculando…</div>`;
    if (simState.tax) renderSimTax();
  }

  // compra a precio de HOY y efecto en la venta al precio objetivo
  const mercado = Number(n.coin.price) || 0;
  const importe = Number(simState.buyAmount) || 0;
  const unidades = mercado > 0 ? importe / mercado : 0;
  $('#sim-comprar').innerHTML = `<header class="card-head"><div><h2>¿Y si invierto más?</h2>
      <p class="card-sub">Comprar al precio de hoy (${priceFmt(mercado)}) y vender a ${priceFmt(n.price)}</p></div></header>
    <div class="form-row" style="margin-bottom:10px">
      <label class="field"><span>Invertir (€)</span>
        <input id="sim-buy-eur" type="number" step="any" min="0" inputmode="decimal" value="${esc(simState.buyAmount)}"></label>
      <label class="field"><span>Comprarías</span>
        <input id="sim-buy-qty" readonly value="${num(unidades, 8)} ${esc(simState.symbol)}"></label>
    </div>
    <div id="sim-buy-body" class="buy-wrap"><p class="muted tiny">Calculando…</p></div>`;
  renderSimBuy(unidades);

  renderSimPosicion();
  renderSimExtras(n, r);
  renderSimSaved();
}

export function renderSimPosicion() {
  const box = $('#sim-resumen');
  if (!box) return;
  const n = simNumbers();
  if (!n) return;
  const c = n.coin;
  if (!(Number(c.amount) > 0)) {
    box.innerHTML = `<header class="card-head">
        <div><h2>${esc(c.symbol)} a ${priceFmt(n.price)}</h2>
        <p class="card-sub">No tienes posición en esta moneda</p></div>
      </header>
      <p class="hint" style="margin:0">Está en <b>Seguimiento</b>. Usa la tarjeta <b>«¿Y si invierto más?»</b> para simular una compra a precio de hoy y ver cuánto ganarías si vendes a ${priceFmt(n.price)}.</p>`;
    return;
  }
  // Base de coste medio para el resumen de la posición (los impuestos FIFO
  // están en la tarjeta «¿Y si vendo?», que usa el cálculo del servidor).
  const conocidos = !!c.costKnown;
  const invertido = conocidos ? (Number(c.invested) || 0) : null;
  const objetivo = n.newCoinValue;
  const bruto = invertido === null ? null : objetivo - invertido;
  const pct = invertido && invertido > 0 ? (bruto / invertido) * 100 : null;
  const fila = (etiqueta, valor, clase) => `<div class="pos-line"><span>${etiqueta}</span><b class="${clase || ''}">${valor}</b></div>`;

  box.innerHTML = `<header class="card-head">
      <div><h2>Tu ${esc(c.symbol)} a ${priceFmt(n.price)}</h2>
      <p class="card-sub">Lo que has puesto y lo que valdría a ese precio.</p></div>
    </header>
    <div class="pos-grid">
      ${fila('Inversión total', invertido === null ? '—' : eur(invertido))}
      ${fila('Cantidad', num(c.amount, 8) + ' ' + esc(c.symbol))}
      ${fila('Precio medio de compra', c.costKnown ? priceFmt(c.avgPrice) : '—')}
      ${fila('Valdría a ' + priceFmt(n.price), eur(objetivo))}
      ${fila('Beneficio bruto', bruto === null ? '—' : (bruto >= 0 ? '+' : '') + eur(bruto) + (pct === null ? '' : ` (${(pct >= 0 ? '+' : '') + num(pct, 1)} %)`), bruto === null ? '' : (bruto >= 0 ? 'pos' : 'neg'))}
    </div>
    <p class="hint" style="margin:10px 0 0">${bruto === null ? 'Sin coste conocido: el beneficio no se puede calcular hasta que importes el historial.' : 'Beneficio = valor a ese precio − lo que invertiste (coste medio). El desglose con impuestos FIFO está en «¿Y si vendo?».'}</p>`;
}

export async function renderSimBuy(unidades) {
  const body = $('#sim-buy-body');
  if (!body) return;
  const n = simNumbers();
  if (!n) return;
  const qty = Number(unidades) || (Number(simState.buyAmount) / (Number(n.coin.price) || 1));
  if (!(qty > 0)) { body.innerHTML = '<p class="muted tiny">Escribe cuánto quieres invertir.</p>'; return; }
  try {
    const d = await api(`/api/simulate/buy?symbol=${encodeURIComponent(simState.symbol)}&qty=${qty}&target=${n.price}`);
    if (state.view !== 'sim') return;
    const o = d.antes, x = d.despues, k = d.diferencia;
    const sgn = (v) => (v >= 0 ? '+' : '');
    const cls = (v) => (v >= 0 ? 'pos' : 'neg');
    const cambio = Number(k.beneficioNeto) || 0;
    const tarjeta = (titulo, sub, datos, destacado) => `
      <div class="buy-card${destacado ? ' is-now' : ''}">
        <div class="buy-card-head"><span>${titulo}</span><small>${sub}</small></div>
        ${datos.map(([k2, v, clase]) => `<div class="buy-line"><span>${k2}</span><b class="${clase || ''}">${v}</b></div>`).join('')}
      </div>`;

    body.innerHTML = `
      <div class="buy-compare">
        ${tarjeta('Ahora', 'tu cartera real', [
          ['Cantidad', num(o.cantidad, 6)],
          ['Precio medio', o.cantidad > 0 ? priceFmt(o.media) : '—'],
          ['Invertido', eur(o.invertido)],
          ['Valdría a ' + priceFmt(d.target), eur(o.ingreso)],
          ['Impuestos', eur(o.impuestos)],
          ['Beneficio neto', sgn(o.beneficioNeto) + eur(o.beneficioNeto), cls(o.beneficioNeto)],
        ], true)}
        <div class="buy-arrow" aria-hidden="true">→</div>
        ${tarjeta('Con ' + eur(Number(simState.buyAmount) || 0), 'cartera + simulación', [
          ['Cantidad', num(x.cantidad, 6)],
          ['Precio medio', priceFmt(x.media)],
          ['Invertido', eur(x.invertido)],
          ['Valdría a ' + priceFmt(d.target), eur(x.ingreso)],
          ['Impuestos', eur(x.impuestos)],
          ['Beneficio neto', sgn(x.beneficioNeto) + eur(x.beneficioNeto), cls(x.beneficioNeto)],
        ])}
      </div>
      <p class="buy-summary ${cambio > 0 ? 'pos' : cambio < 0 ? 'neg' : ''}">${Math.abs(cambio) < 0.01
        ? `Comprar y vender al mismo precio <b>no cambia tu beneficio neto</b>: los ${eur(Number(simState.buyAmount) || 0)} que pones los recuperas al vender.`
        : `Tu beneficio neto ${cambio > 0 ? 'mejora' : 'empeora'} <b>${sgn(cambio)}${eur(cambio)}</b>${k.rentabilidad !== null ? ` (${num(k.rentabilidad, 0)} % sobre los ${eur(k.invertido)} que pones)` : ''}.`}</p>`;
  } catch (e) {
    body.innerHTML = `<p class="muted tiny">${esc(e.message)}</p>`;
  }
}

export function renderSimTax() {
  const body = $('#sim-vender-body');
  if (!body) return;
  const t = simState.tax;
  if (!t || !t.ok) { body.innerHTML = `<p class="muted tiny">${esc((t && t.message) || 'No se pudo calcular.')}</p>`; return; }
  const fifo = t.fifo || {};
  const gain = Number(fifo.gain) || 0;
  renderSimPosicion();
  body.innerHTML = `
    <div><span>Ingreso</span><b>${eur(t.proceeds)}</b></div>
    <div><span>Coste FIFO</span><b>${eur(fifo.cost)}</b></div>
    <div><span>Resultado</span><b class="${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}${eur(gain)}</b></div>
    <div><span>Impuestos estimados</span><b>${eur(fifo.tax)}</b></div>
    <div><span>Te quedarían</span><b>${eur(t.netAfterTax)}</b></div>
    <p class="hint" style="margin:10px 0 0">${gain > 0 ? 'Se aplican los tramos del ahorro sobre la ganancia.' : 'Si vendes con pérdidas no tributas: se compensan en la declaración.'}</p>`;
}

export function renderSimExtras(n, r) {
  const box = $('#sim-extras');
  if (!box) return;
  const avg = Number(n.coin.avgPrice) || 0;
  const need = n.price > 0 && avg > 0 ? ((avg / n.price) - 1) * 100 : null;
  const target = avg > 0 ? avg * 0.9 : 0;
  const b = target > n.price && n.price > 0 ? ((target * n.coin.amount - n.coin.invested) * n.price) / (n.price - target) : -1;
  const bText = b > 0 ? `${eur(b)} a ${priceFmt(n.price)} te dejarían la media en ${priceFmt(target)}` : 'a ese precio no se puede bajar la media comprando';

  const hoy = Number(n.coin.price) || 0;
  const veces = hoy > 0 && r.ath ? r.ath / hoy : null;
  box.innerHTML = `<header class="card-head"><div><h2>Datos que ayudan</h2><p class="card-sub">Equilibrio, histórico y cuánto haría falta.</p></div></header>${avisoExchange(r) ? `<p class="hint">${avisoExchange(r)}</p>` : ''}
    <div class="sim-kpis">
      <div class="stat"><span>Precio actual</span><strong>${priceFmt(hoy)}</strong><small>${n.coin.dayChangePct === null || n.coin.dayChangePct === undefined ? 'ahora mismo' : `hoy ${n.coin.dayChangePct >= 0 ? '+' : ''}${num(n.coin.dayChangePct, 2)} %`}</small></div>
      <div class="stat"><span>Máximo histórico</span><strong>${r.ath ? priceFmt(r.ath) : '—'}</strong><small>${athFuente(r) || 'sin dato histórico'}${veces ? ' · ' + num(veces, 1) + '× el precio de hoy' : ''}</small></div>
      <div class="stat"><span>Precio de equilibrio</span><strong>${avg ? priceFmt(avg) : '—'}</strong><small>${need === null ? '' : `estás ${need >= 0 ? '+' : ''}${num(need, 1)} % de ahí`}</small></div>
      <div class="stat"><span>Si hubieras vendido en máx. histórico</span><strong>${r.ath && n.coin.amount > 0 ? eur(n.coin.amount * r.ath) : '—'}</strong><small>${n.coin.amount > 0 ? (r.ath ? 'bruto, antes de impuestos' : 'sin dato histórico') : 'sin posición'}</small></div>
      <div class="stat"><span>Para bajar tu media un 10 %</span><strong>${b > 0 ? eur(b) : '—'}</strong><small>${bText}</small></div>
      <div class="stat"><span>Diferencia con tu media</span><strong>${n.vsAvg === null ? '—' : (n.vsAvg >= 0 ? '+' : '') + num(n.vsAvg, 1) + ' %'}</strong><small>precio frente a ${avg ? priceFmt(avg) : '—'}</small></div>
    </div>`;
}

export function renderSimSaved() {
  const box = $('#sim-guardados');
  if (!box) return;
  const list = simSaved();
  const p = state.portfolio;
  box.innerHTML = `<header class="card-head">
      <div><h2>Escenarios guardados</h2><p class="card-sub">Compara varios precios a la vez.</p></div>
      <button class="btn btn-ghost btn-xs" id="sim-save">Guardar el actual</button>
    </header>
    ${list.length ? `<table class="table"><thead><tr><th>Moneda</th><th class="num">Precio</th><th class="num">Valdría</th><th class="num">Beneficio</th><th></th></tr></thead><tbody>
      ${list.map((s, i) => {
        const c = ((p && p.coins) || []).find(x => x.symbol === s.symbol);
        if (!c) return '';
        const valor = c.amount * s.price;
        const delta = valor - (Number(c.invested) || 0);
        return `<tr><td>${esc(s.symbol)}</td><td class="num">${priceFmt(s.price)}</td><td class="num">${eur(valor)}</td>
          <td class="num ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${eur(delta)}</td>
          <td class="num"><button class="btn btn-ghost btn-xs" data-sim-del="${i}">Quitar</button></td></tr>`;
      }).join('')}</tbody></table>` : '<p class="muted tiny">Todavía no has guardado ninguno. Ajusta un precio y pulsa «Guardar el actual».</p>'}`;
}
