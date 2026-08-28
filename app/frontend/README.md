# Frontend React/Vite incremental

Esta carpeta es una superficie incremental de React + Vite. No reemplaza `app/public` ni sus flujos actuales: sirve para migrar pantallas una por una mientras el BFF conserva el contrato `/api/v1/public/...`.

## Desarrollo

```bash
npm ci
VITE_VENUE_SLUG=casa-aurora npm run dev
```

El proxy local de Vite reenvía `/api` a `http://localhost:3000`. No se deben colocar secretos en variables `VITE_*`; solo configuración pública como el slug.

## Publicación progresiva

```bash
npm ci
npm run build
```

El resultado queda en `dist/` y puede publicarse como fallback estático en HostGator dentro de un subdirectorio o dominio separado. El BFF PHP/Supabase debe seguir atendiendo `/api`; si se publica el frontend en un dominio distinto, configura CORS explícito y `credentials` según la política de sesión.

Para activar una pantalla migrada, cambia el enlace o ruta del HTML existente hacia este `dist/`; no borres `app/public` hasta que el flujo equivalente haya pasado pruebas de aceptación, accesibilidad, móvil y producción. El botón de checkout de esta primera superficie es deliberadamente un placeholder y no debe habilitarse como checkout productivo hasta conectar el flujo real del BFF.
