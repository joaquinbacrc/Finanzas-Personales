# Finanzas — Contexto del proyecto

Este archivo se carga automáticamente cuando Claude Code abre esta carpeta. Contiene el contexto necesario para retomar el trabajo sin re-explicar todo.

## Qué es este proyecto

App de finanzas personales del usuario (Joaquin). **Migración** de una app original en Google Apps Script + Google Sheets ([../08-finanzas/](../08-finanzas/)) a Node.js moderno.

Está **deployada en producción en Cloudflare Workers** con datos reales del usuario.
⚠️ **Railway está caído** (404) — ya no es producción. Ver la sección de deploy.

## Stack actual

- **Runtime**: Node.js 22+ (uso `node:sqlite` built-in, requiere ≥22.5)
- **Backend**: Express + TypeScript (módulos ESM)
- **DB**: SQLite vía `node:sqlite` (sin deps nativas — no requiere Python ni compilación)
- **Frontend**: HTML + CSS + JS vanilla, **el mismo diseño premium del original** (Fraunces / Inter / JetBrains Mono, dark mode, mobile-first). NO está reescrito en React/Vue — la UI original se mantiene 1:1, solo se adaptó la capa de comunicación.
- **Auth**: cookie firmada con HMAC (sin libs externas), variable `APP_PASSWORD`
- **PWA**: instalable en celular (manifest + service worker + iconos)
- **Deploy**: Cloudflare Workers + D1 (`worker.js` + `wrangler.toml`), por Workers Builds en
  cada push. El Dockerfile y `railway.json` son del deploy viejo de Railway, ya muerto.

## Cómo trabaja la app

El frontend usa un **shim** en `public/index.html` que mapea `google.script.run.X(args)` → `fetch('/api/...')`. Esto preserva el código original de la UI sin tocarlo. Cuando agregues endpoints, agregalos también al shim para mantener la compatibilidad.

## Estado del deploy en producción

**Verificado en vivo el 20/08/2026.** Antes este archivo decía que producción era Railway;
era falso y costó tiempo de diagnóstico. Si dudás, verificalo de nuevo con
`curl -s -o /dev/null -w "%{http_code}" <url>` antes de creerle a este archivo.

- **URL**: https://finanzas-personales.omnia-ar.workers.dev
- **Worker**: `finanzas-personales`, en la cuenta Cloudflare **joaquin.bacrc**
  (account_id `3109bafc25ef8e8a041451ecde2f07b3`, subdominio `omnia-ar`)
- **D1**: base `finanzas`, id `95b026e8-bb6e-40c0-94d3-5addd2d04041`
- **Deploy**: **Workers Builds en cada push** (~40 s, medido)
- **Repo GitHub**: https://github.com/joaquinbacrc/Finanzas-Personales (**público**)
- **Variables**: `APP_PASSWORD`, `SESSION_SECRET`
- **Railway**: ⚠️ **MUERTO**. `finanzas-personales-production-fec6.up.railway.app` devuelve 404.
  Proyecto `tender-kindness` (ID `3fae3f56-5b28-498d-9a56-fcf54758dfe8`). El Dockerfile,
  `railway.json` y `DB_PATH=/data/finanzas.db` son de esa etapa.

### Backup

**No hay backup en archivo** y el `.gitignore` excluye `*.db` y `*.csv`, así que **la D1 es la
única copia de los datos**. La red de seguridad es **D1 Time Travel: 30 días**. En la Console
de D1: `/bookmark` para marcar un punto y `/restore <id>` para volver. El dashboard de D1 **no
tiene botón de export** — el export es solo por `npx wrangler d1 export finanzas --remote`.

Las credenciales de Cloudflare de la PC del usuario (MCP y wrangler, `jsanchez@zecat.com`) **no
alcanzan la cuenta `joaquin.bacrc`**: solo llegan a las dos cuentas de Zecat. Para tocar la base
hay que pedirle al usuario que corra el SQL en la Console de D1.

## Cómo correr local

```bash
npm install
npm run dev    # tsx watch en :3000
```

Doble click en `iniciar-finanzas.bat` también arranca el server (Windows).

## Cómo deployar cambios

`git push origin main` → **Cloudflare Workers Builds redeploya solo** (~40 s, medido).

### ⚠️ `worker.js` es el fuente de producción

`wrangler.toml` apunta a `main = "worker.js"`: **Cloudflare sirve ese archivo**, no `src/`.

Una versión anterior de este documento decía que `worker.js` era "un bundle de `src/*.ts`" y
que faltaba un `npm run build:worker` con esbuild. **Eso es falso y seguir ese consejo tumba la
app.** Verificado el 20/08/2026:

| | `src/services/finanzas.ts` | la misma sección dentro de `worker.js` |
|---|---|---|
| Estilo | **100 % síncrono** (cero `await`) | **async**, `await db.prepare().bind().run()` |
| DB | `node:sqlite` | D1 |

`worker.js` es un bundle de esbuild de una versión **async portada a D1** cuyos fuentes **no
están en el repo**: entre sus marcas de origen figura `// src/worker.ts`, un archivo que no
existe y que **nunca estuvo en git** (`git log --all -- src/worker.ts` sale vacío). Los `src/*.ts`
que sí están son la versión de Express + `node:sqlite` del deploy de Railway, que está muerto.

> **`worker.js` se edita A MANO.** No lo regeneres con esbuild desde `src/`: produciría código
> síncrono de `node:sqlite` corriendo en Workers y la app se cae entera.

> **Editar `src/` NO cambia producción, y no da ningún síntoma.**

Al tocar lógica compartida (`auth`, `db`, `finanzas`) aplicá el cambio en los dos lados —
`worker.js` porque es el que corre, `src/` para que el fuente legible no divergen — y corré:

```bash
npm run check:worker
```

Ese guardrail (`tools/check-worker.mjs`, sin dependencias) falla si tocaste `src/auth.ts`,
`src/db.ts` o `src/services/finanzas.ts` sin tocar `worker.js`. Es lo único que convierte ese
silencio en un aviso.

**Deuda pendiente**: reconstruir los fuentes async del worker (`src/worker/*.ts`) a partir de
`worker.js` y recién entonces montar un build de verdad. Es un porteo de ~700 líneas de lógica
financiera y hay que verificar equivalencia número por número, así que no es un rato.

## ⚠️ Modelo de datos: leer antes de tocar meses o el cierre

Esto no estaba documentado y es la fuente de los peores malentendidos de la app.

- **`gastos` NO tiene columna de mes.** Es "el mes en curso", nada más. Cada fila sí tiene su
  `fecha` propia, en **texto `DD/MM/YYYY`**. Ojo: `MIN`/`MAX`/`ORDER BY` sobre ese formato
  ordena **alfabéticamente, no cronológicamente**. Para agrupar por mes: `substr(fecha,4,2)`.
- **El rótulo del mes es texto libre** en `settings.titulo` (`💰 FINANZAS PERSONALES — Mes Año`).
  No filtra ni define nada: es solo lo que se muestra.
- **`historico` guarda solo 7 números agregados** por mes cerrado (ingresos, gastos, margen,
  pct_variable, sobrantes). **No guarda el detalle de los gastos.**

### `cerrarMes()` es destructivo

Escribe el resumen en `historico`, borra los gastos que contabilizó y reinserta **solo los de
tipo `Fijo`**, con la fecha reescrita a `01/MM/AAAA` del mes nuevo y estado `Pendiente` (las
cuotas avanzan `n/total`). Los `Variable` se descartan.

> **El detalle de cada mes cerrado se pierde para siempre.** Conviene exportar el CSV antes
> (Config → Exportar a CSV, o el botón "CSV" en el header de Resumen).

Detalles de implementación que importan:

- **Se borra por id, no `DELETE FROM gastos`.** Se borran solo los ids que se contabilizaron,
  verificando con `meta.changes`; si no coincide, **aborta antes de escribir el histórico**.
  El wipe global funcionaba, pero borraba a ciegas cualquier gasto cargado entre la lectura del
  estado y el borrado, sin haberlo contabilizado.
- **El orden importa**: primero se insertan los fijos del mes nuevo (ids nuevos, sobreviven al
  delete), después se borra lo viejo, y el histórico **al final**, para que ningún fallo
  intermedio deje gastos borrados sin respaldo.
- **Poka-yoke**: cerrar hacia el mismo mes tira error. El 31/07/2026 se cerró "Julio 2026"
  eligiendo "Julio" otra vez; el rótulo quedó clavado y **todo agosto se cargó dentro de un mes
  llamado julio**, con los fijos del mes nuevo fechados `01/07/2026`. Eso desordenó cuatro meses
  de datos y llevó a creer que se habían borrado (no se había borrado nada).

### Si la app muestra números absurdos

Antes de suponer pérdida de datos, agrupá los gastos por mes y cruzá `created_at` con el
`created_at` de cada fila de `historico` (que es el timestamp del cierre). Eso es lo que
desarmó el caso del 20/08/2026: parecía un borrado y era un rótulo mal puesto más filas viejas
reinyectadas con su `created_at` original (por un `/restore` de Time Travel o `/api/import-db`).

```sql
SELECT substr(fecha,7,4) AS anio, substr(fecha,4,2) AS mes, moneda, COUNT(*) AS cant,
       ROUND(SUM(monto_ars)) AS ars, ROUND(SUM(monto_ext)) AS ext,
       MIN(date(created_at,'unixepoch')) AS creado_desde,
       MAX(date(created_at,'unixepoch')) AS creado_hasta
FROM gastos GROUP BY anio, mes, moneda ORDER BY anio, mes, moneda;
```

## Decisiones técnicas tomadas (con razones)

- **`node:sqlite` en vez de `better-sqlite3`**: better-sqlite3 requiere compilación nativa (Python + node-gyp). En Windows del usuario falló por falta de Python. node:sqlite es built-in en Node ≥22.5, sin deps.
- *(histórico, Railway ya no es producción)* **Dockerfile en vez de Nixpacks**: Nixpacks tenía un bug de EBUSY con el cache de npm en Railway que rompía el build. Dockerfile es predecible.
- **DB Proxy para reapertura en caliente**: el endpoint `POST /api/import-db` cierra y reabre la conexión SQLite cuando se sube un archivo nuevo. Por eso `db.ts` exporta un Proxy que delega a `_db` (mutable internamente).
- **Auth cookie casera (HMAC) en vez de express-session**: menos deps, más control, suficiente para single-user.
- *(histórico)* **NO se eliminó el proyecto basura "thorough-rejoicing"** del usuario en Railway (lo creó por error el Agent de Railway en la primera sesión). No molesta, no consume recursos.

## Archivos clave

### Lo que corre en producción

- [worker.js](worker.js) — **backend completo (async/D1). Es el fuente, se edita a mano.**
- [wrangler.toml](wrangler.toml) — config del Worker: `main`, binding `ASSETS`, D1 `finanzas`
- [public/index.html](public/index.html) — frontend completo (UI original adaptada con shim)
- [public/login.html](public/login.html) — pantalla de login
- [public/sw.js](public/sw.js) — service worker. **No intercepta navegaciones, a propósito**
  (ver la sección del SW más abajo)
- [tools/check-worker.mjs](tools/check-worker.mjs) — guardrail `npm run check:worker`

### Legado de Railway (NO corre en producción)

`src/` es la versión síncrona de Express + `node:sqlite`. Sirve como fuente legible de la
lógica y para correr local, pero **editarlo no cambia producción**.

- [src/server.ts](src/server.ts) — Express + endpoints REST
- [src/db.ts](src/db.ts) — schema, seeds, helpers de transacción, importDbFile
- [src/services/finanzas.ts](src/services/finanzas.ts) — lógica de negocio (porteo de Code.gs)
- [src/auth.ts](src/auth.ts) — login con cookie firmada
- [src/scripts/import-csv.ts](src/scripts/import-csv.ts) — importador del CSV del Sheet original
- [Dockerfile](Dockerfile) + [railway.json](railway.json) — deploy de Railway, muerto
- [DEPLOY.md](DEPLOY.md) — guía de deploy de Railway, obsoleta
- [ROADMAP.md](ROADMAP.md) — migrar **las otras 8 apps** de Apps Script a Cloudflare con
  multi-app + multi-user. **No confundir**: que *esta* app esté en Cloudflare no significa que
  el roadmap se haya hecho. ⚠️ Verificar igual si sigue vigente: varias de esas apps
  (Control de Stock, Producción, Mantenimiento, Arte, Merma, Proyectos) parecen vivir hoy como
  módulos del Panel ZECAT, por una vía distinta a la que este roadmap plantea

## El service worker no intercepta navegaciones (a propósito)

`public/sw.js` deja pasar a la red toda request con `mode === 'navigate'`, y nunca cachea ni
devuelve respuestas `redirected` u opacas. **No lo "optimices" precacheando `/`, `/index.html`
o `/login.html`**: esas tres son navegaciones y la app tiene auth, así que el worker les
responde un redirect a `/login`. Un SW no puede contestar una navegación con una respuesta
redirected sacada del caché, y Chrome corta con `ERR_FAILED` — la app parece caída estando
perfectamente sana. Pasó el 20/08/2026 y dejó al usuario afuera.

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
