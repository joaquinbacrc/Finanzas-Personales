# Finanzas — Contexto del proyecto

Este archivo se carga automáticamente cuando Claude Code abre esta carpeta. Contiene el contexto necesario para retomar el trabajo sin re-explicar todo.

## Qué es este proyecto

App de finanzas personales del usuario (Joaquin). **Migración** de una app original en Google Apps Script + Google Sheets ([../08-finanzas/](../08-finanzas/)) a Node.js moderno.

Está **deployada en producción** en Railway con datos reales del usuario.

## Stack actual

- **Runtime**: Node.js 22+ (uso `node:sqlite` built-in, requiere ≥22.5)
- **Backend**: Express + TypeScript (módulos ESM)
- **DB**: SQLite vía `node:sqlite` (sin deps nativas — no requiere Python ni compilación)
- **Frontend**: HTML + CSS + JS vanilla, **el mismo diseño premium del original** (Fraunces / Inter / JetBrains Mono, dark mode, mobile-first). NO está reescrito en React/Vue — la UI original se mantiene 1:1, solo se adaptó la capa de comunicación.
- **Auth**: cookie firmada con HMAC (sin libs externas), variable `APP_PASSWORD`
- **PWA**: instalable en celular (manifest + service worker + iconos)
- **Deploy**: Railway con Dockerfile + volumen persistente en `/data`

## Cómo trabaja la app

El frontend usa un **shim** en `public/index.html` que mapea `google.script.run.X(args)` → `fetch('/api/...')`. Esto preserva el código original de la UI sin tocarlo. Cuando agregues endpoints, agregalos también al shim para mantener la compatibilidad.

## Estado del deploy en producción

- **URL**: https://finanzas-personales-production-fec6.up.railway.app
- **Proyecto Railway**: `tender-kindness` (project ID `3fae3f56-5b28-498d-9a56-fcf54758dfe8`)
- **Servicio**: `Finanzas-Personales`
- **Repo GitHub**: https://github.com/joaquinbacrc/Finanzas-Personales (privado)
- **Variables**: `APP_PASSWORD`, `SESSION_SECRET`, `DB_PATH=/data/finanzas.db`
- **Volumen**: 1 GB montado en `/data`
- **Datos**: 38 gastos del mes Mayo 2026 importados desde el CSV original

## Cómo correr local

```bash
npm install
npm run dev    # tsx watch en :3000
```

Doble click en `iniciar-finanzas.bat` también arranca el server (Windows).

## Cómo deployar cambios

`git push origin main` → Railway redeploya solo (Dockerfile build, ~1–2 min).

## Decisiones técnicas tomadas (con razones)

- **`node:sqlite` en vez de `better-sqlite3`**: better-sqlite3 requiere compilación nativa (Python + node-gyp). En Windows del usuario falló por falta de Python. node:sqlite es built-in en Node ≥22.5, sin deps.
- **Dockerfile en vez de Nixpacks**: Nixpacks tenía un bug de EBUSY con el cache de npm en Railway que rompía el build. Dockerfile es predecible.
- **DB Proxy para reapertura en caliente**: el endpoint `POST /api/import-db` cierra y reabre la conexión SQLite cuando se sube un archivo nuevo. Por eso `db.ts` exporta un Proxy que delega a `_db` (mutable internamente).
- **Auth cookie casera (HMAC) en vez de express-session**: menos deps, más control, suficiente para single-user.
- **NO se eliminó el proyecto basura "thorough-rejoicing"** del usuario en Railway (lo creó por error el Agent de Railway en la primera sesión). No molesta, no consume recursos.

## Archivos clave

- [src/server.ts](src/server.ts) — Express + endpoints REST
- [src/db.ts](src/db.ts) — Schema, seeds, helpers de transacción, importDbFile
- [src/services/finanzas.ts](src/services/finanzas.ts) — Lógica de negocio (porteo de Code.gs original)
- [src/auth.ts](src/auth.ts) — Login con cookie firmada
- [src/scripts/import-csv.ts](src/scripts/import-csv.ts) — Importador del CSV exportado del Sheet original
- [public/index.html](public/index.html) — Frontend completo (UI original adaptada con shim)
- [public/login.html](public/login.html) — Pantalla de login
- [Dockerfile](Dockerfile) + [railway.json](railway.json) — Config de deploy
- [DEPLOY.md](DEPLOY.md) — Guía manual paso a paso (no relevante si ya está deployado)
- [ROADMAP.md](ROADMAP.md) — Plan a futuro (multi-app + multi-user en Cloudflare)

## Sobre el usuario

- **Nivel técnico**: no técnico. No sabe qué es Git, npm, SQL, browsers, ni qué significa "localhost".
- **Preferencia de colaboración**: explícita y repetida — "hacé todo vos". Quiere instrucciones cero / acción máxima.
- **Comunicación**: en español, tono casual. Evitar tecnicismos sin explicar. Cuando algo requiera intervención suya, ser MUY claro y específico (un solo paso a la vez, no listas de 7 pasos).
- **No tenía Git instalado** — se instaló vía winget en sesión previa. Está en `C:\Program Files\Git`.
- **Email**: joaquin.bacrc@gmail.com
- **Usuario GitHub**: joaquinbacrc
- **PowerShell en español** (Windows 11 Home) — los errores vienen en español, pero las versiones viejas no soportan algunos flags como `-SkipHttpErrorCheck`.

## Plan a futuro (NO ejecutar sin pedido explícito)

Ver [ROADMAP.md](ROADMAP.md). Resumen: el usuario quiere migrar el resto de sus apps (carpetas `01-` a `09-` en `../`) a Cloudflare (Workers + D1 + Pages) como apps separadas que comparten datos y multi-usuario con Cloudflare Access.

**Importante**: el usuario explícitamente dijo "no ahora" para esa migración. No iniciarla hasta que lo pida.
