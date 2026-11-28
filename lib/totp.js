'use strict';
// TOTP (RFC 6238): 6 dígitos, SHA-1, 30 segundos. Compatible con 2FAS,
// Google Authenticator, Authy, Bitwarden y cualquier app estándar.
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO = 30;          // segundos
const DIGITOS = 6;
const VENTANA = 1;        // acepta el código anterior y el siguiente

function base32Encode(buf) {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

function base32Decode(texto) {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) continue;
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo en base32 (160 bits, como recomienda la RFC). */
function nuevoSecreto(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function codigo(secreto, contador) {
  const clave = base32Decode(secreto);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(contador / 0x100000000), 0);
  buf.writeUInt32BE(contador >>> 0, 4);
  const h = crypto.createHmac('sha1', clave).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

function contadorActual(ahora = Date.now()) {
  return Math.floor(ahora / 1000 / PASO);
}

/** Código válido ahora mismo (para pruebas y para la interfaz). */
function codigoActual(secreto, ahora = Date.now()) {
  return codigo(secreto, contadorActual(ahora));
}

/** Comprueba un código de 6 dígitos con margen de ±1 intervalo. */
function verificar(secreto, entrada, ahora = Date.now()) {
  const limpio = String(entrada || '').replace(/\D/g, '');
  if (limpio.length !== DIGITOS || !secreto) return false;
  const base = contadorActual(ahora);
  for (let i = -VENTANA; i <= VENTANA; i++) {
    const esperado = Buffer.from(codigo(secreto, base + i));
    const recibido = Buffer.from(limpio);
    if (esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido)) return true;
  }
  return false;
}

/** Como verificar(), pero devuelve el contador usado (null si no vale). Sirve para
    rechazar la reutilización del mismo código dentro de su ventana. */
function verificarPaso(secreto, entrada, ahora = Date.now()) {
  const limpio = String(entrada || '').replace(/\D/g, '');
  if (limpio.length !== DIGITOS || !secreto) return null;
  const base = contadorActual(ahora);
  for (let i = -VENTANA; i <= VENTANA; i++) {
    const esperado = Buffer.from(codigo(secreto, base + i));
    const recibido = Buffer.from(limpio);
    if (esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido)) return base + i;
  }
  return null;
}

/** URI otpauth:// para el QR. */
function uri(secreto, cuenta, emisor = 'Quanto') {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  const q = new URLSearchParams({
    secret: secreto,
    issuer: emisor,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASO),
  });
  return `otpauth://totp/${etiqueta}?${q.toString()}`;
}

/** Códigos de respaldo de un solo uso (se guardan con hash). */
function codigosRespaldo(n = 10) {
  const lista = [];
  for (let i = 0; i < n; i++) {
    const bruto = crypto.randomBytes(5).toString('hex').toUpperCase();
    lista.push(`${bruto.slice(0, 5)}-${bruto.slice(5)}`);
  }
  return lista;
}

function hashCodigo(texto) {
  return crypto.createHash('sha256').update(String(texto).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
}

module.exports = {
  verificarPaso,
  nuevoSecreto, codigo, codigoActual, verificar, uri, base32Encode, base32Decode,
  codigosRespaldo, hashCodigo, PASO, DIGITOS,
};
