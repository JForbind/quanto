// Build del front con Vite — fase 1: empaquetar sin cambiar el comportamiento.
// app.js se compila como IIFE clásico (sus funciones siguen siendo globales,
// igual que hoy) y el resto se copia tal cual. El HTML no se toca.
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const raiz = import.meta.dirname;
const publicDir = path.join(raiz, 'public');
const salida = path.join(raiz, 'dist');

/** Copia lo que Vite no procesa en modo librería. */
function copiarResto() {
  return {
    name: 'quanto-copiar-resto',
    closeBundle() {
      fs.mkdirSync(salida, { recursive: true });
      for (const f of ['index.html', 'style.css', 'boot-sidebar.js', 'echarts.min.js', 'favicon.png', 'icon.svg', 'manifest.webmanifest', 'sw.js']) {
        const src = path.join(publicDir, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(salida, f));
      }
      for (const dir of ['icons', 'fonts']) {
        const src = path.join(publicDir, dir);
        if (fs.existsSync(src)) fs.cpSync(src, path.join(salida, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: publicDir,
  publicDir: false,
  plugins: [copiarResto()],
  build: {
    outDir: salida,
    emptyOutDir: true,
    target: 'es2020',
    lib: {
      entry: path.join(publicDir, 'app.js'),
      name: 'Quanto',
      formats: ['iife'],
      fileName: () => 'app.js',
    },
  },
  server: { host: '127.0.0.1', port: 5199, proxy: { '/api': 'http://127.0.0.1:8766' } },
});
