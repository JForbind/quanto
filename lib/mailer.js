'use strict';
// Envío de correo (SMTP) para invitaciones y avisos al administrador.
const path = require('path');
const nodemailer = require('nodemailer');
const { readJson, writeJson } = require('./store');

function createMailer(dataDir) {
  const file = path.join(dataDir, 'mail.json');

  function stored() {
    const raw = readJson(file, {}) || {};
    return {
      host: String(raw.host || ''),
      port: Number(raw.port) || 465,
      secure: raw.secure !== false,
      user: String(raw.user || ''),
      pass: String(raw.pass || ''),
      from: String(raw.from || ''),
      fromName: String(raw.fromName || 'Quanto'),
    };
  }

  /** Entorno por encima del archivo (para docker-compose). */
  function config() {
    const cfg = stored();
    if (process.env.SMTP_HOST) cfg.host = process.env.SMTP_HOST;
    if (process.env.SMTP_PORT) cfg.port = Number(process.env.SMTP_PORT);
    if (process.env.SMTP_SECURE) cfg.secure = String(process.env.SMTP_SECURE) !== 'false';
    if (process.env.SMTP_USER) cfg.user = process.env.SMTP_USER;
    if (process.env.SMTP_PASS) cfg.pass = process.env.SMTP_PASS;
    if (process.env.SMTP_FROM) cfg.from = process.env.SMTP_FROM;
    if (process.env.SMTP_FROM_NAME) cfg.fromName = process.env.SMTP_FROM_NAME;
    return cfg;
  }

  function save(patch) {
    const current = stored();
    const next = { ...current, ...patch };
    writeJson(file, next);
    return next;
  }

  function ready() {
    const c = config();
    return !!(c.host && c.user && c.pass);
  }

  function transport() {
    const c = config();
    return nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: c.pass },
    });
  }

  async function send({ to, subject, text, html }) {
    if (!ready()) throw new Error('El correo no está configurado');
    const c = config();
    const from = c.from || c.user;
    const info = await transport().sendMail({
      from: `"${c.fromName || 'Quanto'}" <${from}>`,
      to,
      subject,
      text,
      html: html || undefined,
    });
    return info;
  }

  async function verify() {
    if (!ready()) throw new Error('Faltan servidor, usuario o contraseña');
    await transport().verify();
    return true;
  }

  function publicConfig() {
    const c = config();
    const env = !!process.env.SMTP_HOST;
    return {
      host: c.host,
      port: c.port,
      secure: c.secure,
      user: c.user,
      from: c.from || c.user,
      fromName: c.fromName || 'Quanto',
      hasPass: !!c.pass,
      ready: ready(),
      source: env ? 'env' : 'file',
    };
  }

  return { config, save, ready, send, verify, publicConfig };
}

module.exports = { createMailer };
