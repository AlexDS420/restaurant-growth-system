import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // El paquete se sirve en HostGator y en previews bajo subdirectorios.
  // Rutas relativas evitan que /assets apunte al dominio raíz equivocado.
  base: './',
  plugins: [react(), tailwindcss(), legacyAdminAssets()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: {
    sourcemap: false,
    target: 'es2022',
    rollupOptions: { external: [/^\/assets\/(admin|ui)\.js$/], input: { main: 'index.html', home: 'home.html', carta: 'carta.html', login: 'login.html', admin: 'admin.html', restaurante: 'restaurante.html', cliente: 'cliente.html' } },
  },
});

// El panel operativo completo se mantiene en un único runtime legacy ya probado.
// Se publica como assets del build FoodiPro para evitar duplicar 15 módulos y sus
// formularios dentro de React, conservando endpoints y RBAC existentes.
function legacyAdminAssets() {
  const source = path.resolve(__dirname, '../public/assets');
  return {
    name: 'restaurant-os-legacy-admin-assets',
    generateBundle() {
      for (const file of ['admin.js', 'ui.js', 'app.css']) {
        this.emitFile({ type: 'asset', fileName: `assets/${file}`, source: fs.readFileSync(path.join(source, file)) });
      }
    },
  };
}
