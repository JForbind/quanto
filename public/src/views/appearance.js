'use strict';
// Apariencia: fondo de pantalla y foto de perfil del usuario.
import { $, api, toast } from '../core.js';

/* ------------------------------------------------ apariencia (fondo y avatar) */
function appearanceUrl(kind, ts) {
  return '/api/' + kind + '?v=' + (ts || Date.now());
}

function applyWallpaper(on, ts) {
  // En móvil el fondo a tamaño completo consume mucha memoria y puede tumbar el
  // WebView al abrir Ajustes; allí se deja el fondo liso.
  const cabe = window.innerWidth >= 900;
  if (on && cabe) {
    document.body.style.setProperty('--wallpaper', `url("${appearanceUrl('wallpaper', ts)}")`);
    document.body.classList.add('has-wallpaper');
  } else {
    document.body.classList.remove('has-wallpaper');
    document.body.style.removeProperty('--wallpaper');
  }
}

function applyAvatar(on, ts) {
  const btn = $('#avatar-btn');
  const img = $('#user-avatar');
  if (!btn || !img) return;
  if (on) {
    img.src = appearanceUrl('avatar', ts);
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
    img.removeAttribute('src');
  }
}

/** Miniatura cuadrada en dataURL: evita retener la imagen a tamaño completo. */
async function miniatura(url, lado = 96) {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = lado; c.height = lado;
    const ctx = c.getContext('2d');
    const r = Math.max(lado / img.width, lado / img.height);
    const w = img.width * r, h = img.height * r;
    ctx.drawImage(img, (lado - w) / 2, (lado - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  } catch {
    return '';
  }
}

function renderAppearancePreviews(a) {
  const set = async (sel, kind, has) => {
    const el = $(sel);
    if (!el) return;
    if (!has) {
      el.style.backgroundImage = '';
      el.classList.remove('has-img');
      return;
    }
    const src = await miniatura(appearanceUrl(kind, a && a.ts && a.ts[kind]));
    if (!src) return;
    el.style.backgroundImage = `url("${src}")`;
    el.classList.add('has-img');
  };
  set('#wallpaper-preview', 'wallpaper', !!(a && a.wallpaper));
  set('#avatar-preview', 'avatar', !!(a && a.avatar));
}

export async function loadAppearance() {
  try {
    const a = await api('/api/appearance');
    applyWallpaper(a.wallpaper, a.ts && a.ts.wallpaper);
    applyAvatar(a.avatar, a.ts && a.ts.avatar);
    renderAppearancePreviews(a);
  } catch { /* sin apariencia personalizada */ }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('No se pudo leer la imagen'));
    fr.readAsDataURL(file);
  });
}

async function fileToResizedDataUrl(file, maxSide, quality) {
  // Leemos el archivo como data: URL (la CSP bloquea blob:)
  const src = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Formato de imagen no compatible (usa JPG, PNG o WebP)'));
    im.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality || 0.86);
}

async function uploadAppearance(kind, file, maxSide) {
  const data = await fileToResizedDataUrl(file, maxSide, 0.86);
  const r = await api('/api/appearance/' + kind, { method: 'POST', body: JSON.stringify({ data }) });
  if (kind === 'avatar') applyAvatar(true, r.ts); else applyWallpaper(true, r.ts);
  renderAppearancePreviews(await api('/api/appearance'));
  toast(kind === 'avatar' ? 'Foto de perfil actualizada' : 'Fondo actualizado');
}

$('#wallpaper-file')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try { await uploadAppearance('wallpaper', file, 1920); }
  catch (err) { toast(err.message, true); }
  finally { e.target.value = ''; }
});

$('#avatar-file')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try { await uploadAppearance('avatar', file, 512); }
  catch (err) { toast(err.message, true); }
  finally { e.target.value = ''; }
});

$('#wallpaper-reset')?.addEventListener('click', async () => {
  try {
    await api('/api/appearance/wallpaper', { method: 'DELETE' });
    applyWallpaper(false);
    renderAppearancePreviews(await api('/api/appearance'));
    toast('Fondo original restaurado');
  } catch (err) { toast(err.message, true); }
});

$('#avatar-reset')?.addEventListener('click', async () => {
  try {
    await api('/api/appearance/avatar', { method: 'DELETE' });
    applyAvatar(false);
    renderAppearancePreviews(await api('/api/appearance'));
    toast('Foto de perfil quitada');
  } catch (err) { toast(err.message, true); }
});
