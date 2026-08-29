import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // El paquete se sirve en HostGator y en previews bajo subdirectorios.
  // Rutas relativas evitan que /assets apunte al dominio raíz equivocado.
  base: './',
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: {
    sourcemap: false,
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', home: 'home.html', carta: 'carta.html', login: 'login.html', admin: 'admin.html', restaurante: 'restaurante.html' } },
  },
});
