# Finanzas — Contexto del proyecto

Este archivo se carga automáticamente cuando Claude Code abre esta carpeta. Contiene el contexto necesario para retomar el trabajo sin re-explicar todo.

## Qué es este proyecto

App de finanzas personales del usuario (Joaquin). **Migración** de una app original en Google Apps Script + Google Sheets a Cloudflare Workers.
El proyecto original sigue existiendo un nivel más arriba de este repo (`../Code.gs` y
`../Index.html`); `finanzas.ts` es el porteo de ese `Code.gs`.

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
- **`settings.historico_categorias`** guarda el **desglose por categoría** de cada mes cerrado,
  como JSON: `{ "Septiembre 2026": { "Comida": 120000, "Hogar": 450000, ... } }` (montos de
  ejemplo, no reales). Ver
  la sección "Desglose por categoría" más abajo. **Existe desde septiembre 2026**: mayo–agosto
  no lo tienen y no se puede recuperar.
- **`estado` tiene tres valores**: `Pagado`, `Pendiente` y **`Pausado`**. Ver "Gastos pausados".

### `cerrarMes()` es destructivo

Escribe el resumen en `historico` **y el desglose por categoría en
`settings.historico_categorias`**, borra los gastos que contabilizó y reinserta **solo los de
tipo `Fijo`**, con la fecha reescrita a `01/MM/AAAA` del mes nuevo y estado `Pendiente` (las
cuotas avanzan `n/total`, **también las de un gasto pausado**). Los `Variable` se descartan.
Los gastos **pausados no suman** ni al histórico ni al desglose.

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

### Runbook: cerrar el mes

Es la única operación destructiva de la app. Cuatro pasos:

1. **Exportá el CSV** (Config → Exportar a CSV). El cierre guarda 7 números en `historico` y
   borra el detalle. Si no exportás, el detalle de ese mes no existe en ningún lado.
2. **`/bookmark`** en la Console de D1 y guardá el id. Es el punto de restauración.
3. **Verificá el mes.** El selector dice *"Mes que se abre"* y se autocompleta con el siguiente
   al actual — no lo cambies salvo que sepas por qué. Elegir el mes actual desordena todo (pasó
   el 31/07/2026); el backend lo rechaza y el front avisa en rojo, pero mirá igual.
4. **Después**: el título tiene que mostrar el mes nuevo, y `SELECT COUNT(*) FROM gastos` tiene
   que dar solo los fijos que pasaron. Si quedó el mes viejo en el título, algo falló.

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

## Desglose por categoría (`historico_categorias`)

**Qué es.** `historico` guarda 7 números por mes y el detalle se borra en el cierre, así que sin
esto no hay forma de comparar categorías mes a mes. `cerrarMes` calcula, **antes de borrar**,
cuánto se gastó en cada categoría (sin los pausados, en ARS equivalente) y lo guarda en
`settings.historico_categorias` con **la misma clave que `historico.mes`** (`"Septiembre 2026"`).
`getAllData` lo manda al front como `historicoCategorias`.

**Por qué en `settings` y no en una columna/tabla nueva:** eso exigía `ALTER TABLE`, y las
credenciales de esta PC no llegan a la cuenta Cloudflare donde vive la D1. `settings` es
clave/valor texto y ya existía: cero migración.

**Límites que no hay que olvidar:**
- **Mayo–agosto 2026 NO tienen desglose y no se puede reconstruir**: se borró en cada cierre.
  El gráfico los muestra como contorno punteado "sin datos", **nunca como barra en cero**
  (cero sería mentir).
- El **mes en curso** no está en `historico_categorias`: el front lo calcula en vivo desde los
  gastos cargados. Recién al cerrar el mes queda guardado.
- Si se renombra una categoría, los meses viejos conservan el nombre viejo: son claves distintas.
- **Nunca commitear los datos** (un dump de `historico_categorias`, un CSV, etc.): **el repo es
  público**.

Probado en `tools/test-gasto-pausado.mjs` (caso 6): el cierre guarda el mes, Comida suma bien y
un gasto pausado no entra.

## Gastos pausados (`estado = 'Pausado'`)

Un gasto **Fijo** se puede pausar un mes con el botón de pausa de su card: sigue en la lista
(atenuado, monto tachado, badge "Pausado") pero **no cuenta en ningún total**. Al cerrar el mes
**vuelve activo solo**, porque `cerrarMes` reinserta los fijos como `Pendiente`.

- **La cuota avanza igual aunque esté pausado.** Pausar NO significa "no lo pago": es sacarlo
  del total del mes por un motivo del usuario. (Una primera versión frenaba la cuota y el
  usuario la hizo revertir.)
- **El dashboard se calcula DOS veces** —`computeDashboard` en `worker.js` y `recalcDashboard`
  en el front— y las dos excluyen pausados con `esPausado()`. Si se toca una sola, el número
  cambia al instante y vuelve al viejo en el próximo F5.
- En `cerrarMes` el pausado **se saltea en las sumas pero NO en la reinserción** del fijo, y su
  id **sigue en `idsContabilizados`** (sacarlo aborta el cierre por la verificación de borrados).
- La card atenúa el **contenido**, no la card: la animación `cardIn` tiene `fill-mode forwards`
  y deja `opacity:1` fijo en la card.

## Resumen: Evolución mensual

Una sola card: barras por mes (últimos 6 + el en curso, marcado con `*`), chips para prender
series (Ingresos, Gastos y cada categoría, máx. 4, se recuerda en `localStorage`) y debajo la
comparación del mes elegido **vs cualquier otro** (selector "vs"; por defecto el anterior):
Ingresos, Gastos, Margen y % Variable siempre, y las categorías prendidas. Reemplazó al donut
"Gastos por categoría" y a la card "Comparar meses", que se sacaron.

- Categorías con paleta propia **sin verde ni rojo** (`EVO_COLORES_CAT`): son de Ingresos y
  Gastos, y con `CHART_COLORS` Transporte y Suscripciones salían iguales a ellos.
- Eje Y con escalones redondos (1/2/2,5/5 × 10ⁿ).
- `renderEvolucion` va en `try/catch` dentro de `renderResumen`: si falla, no se lleva puesto el
  resto del Resumen y el error queda visible en la card.
- En el mes en curso, tocar una categoría abre `verDetalleCategoria` (lo único que hacía el donut).

## Decisiones técnicas tomadas (con razones)

- **`node:sqlite` en vez de `better-sqlite3`**: better-sqlite3 requiere compilación nativa (Python + node-gyp). En Windows del usuario falló por falta de Python. node:sqlite es built-in en Node ≥22.5, sin deps.
- **DB Proxy para reapertura en caliente**: el endpoint `POST /api/import-db` cierra y reabre la conexión SQLite cuando se sube un archivo nuevo. Por eso `db.ts` exporta un Proxy que delega a `_db` (mutable internamente).
- **Auth cookie casera (HMAC) en vez de express-session**: menos deps, más control, suficiente para single-user.

## Archivos clave

### Lo que corre en producción

- [worker.js](worker.js) — **backend completo (async/D1). Es el fuente, se edita a mano.**
- [wrangler.toml](wrangler.toml) — config del Worker: `main`, binding `ASSETS`, D1 `finanzas`
- [public/index.html](public/index.html) — frontend completo (UI original adaptada con shim)
- [public/login.html](public/login.html) — pantalla de login
- [public/sw.js](public/sw.js) — service worker. **No intercepta navegaciones, a propósito**
  (ver la sección del SW más abajo)
- [tools/check-worker.mjs](tools/check-worker.mjs) — guardrail `npm run check:worker`
- [tools/test-gasto-pausado.mjs](tools/test-gasto-pausado.mjs) — pausa + cierre + desglose,
  sobre el código REAL de `worker.js` (21 pruebas). Correr antes de tocar `cerrarMes`
- [tools/test-importador-tarjeta.mjs](tools/test-importador-tarjeta.mjs) — importador del resumen
  de tarjeta contra el Excel real

### Legado de Railway (NO corre en producción)

`src/` es la versión síncrona de Express + `node:sqlite`. Sirve como fuente legible de la
lógica y para correr local, pero **editarlo no cambia producción**.

- [src/server.ts](src/server.ts) — Express + endpoints REST
- [src/db.ts](src/db.ts) — schema, seeds, helpers de transacción, importDbFile
- [src/services/finanzas.ts](src/services/finanzas.ts) — lógica de negocio (porteo de Code.gs)
- [src/auth.ts](src/auth.ts) — login con cookie firmada
- [src/scripts/import-csv.ts](src/scripts/import-csv.ts) — importador del CSV del Sheet original
- [Dockerfile](Dockerfile) + [railway.json](railway.json) — deploy de Railway, muerto

## El service worker no intercepta navegaciones (a propósito)

`public/sw.js` deja pasar a la red toda request con `mode === 'navigate'`, y nunca cachea ni
devuelve respuestas `redirected` u opacas. **No lo "optimices" precacheando `/`, `/index.html`
o `/login.html`**: esas tres son navegaciones y la app tiene auth, así que el worker les
responde un redirect a `/login`. Un SW no puede contestar una navegación con una respuesta
redirected sacada del caché, y Chrome corta con `ERR_FAILED` — la app parece caída estando
perfectamente sana. Pasó el 20/08/2026 y dejó al usuario afuera.

## Sobre el usuario

- **Comunicación**: español rioplatense, tono casual. Prefiere acción sobre preguntas: si algo
  se puede verificar en vez de consultarlo, verificalo.
- **Nivel técnico**: maneja SQL en la consola de D1, git y Cloudflare sin problema. *(Una versión
  anterior de este archivo decía que no sabía qué era Git ni SQL. Quedó vieja y llevaba a explicar
  de más.)* Lo que sí necesita explícito es **qué acción tiene que hacer él**, porque las
  credenciales de Cloudflare de su PC no llegan a la cuenta donde vive esta app.
- **Email**: joaquin.bacrc@gmail.com · **GitHub**: joaquinbacrc
- ⚠️ **La cuenta activa de `gh` se vuelve sola a `joaquinzecat`.** Correr
  `gh auth switch --user joaquinbacrc` **antes de cada push** a este repo.
- **PowerShell en español** (Windows 11) — los errores vienen en español.

## Deuda conocida (NO empezar sin pedido explícito)

- **Reconstruir los fuentes async del worker** antes de montar cualquier build. Ver la sección
  de `worker.js` arriba. Son ~700 líneas de lógica financiera a portear verificando número por
  número.
- **No hay backup en archivo.** Time Travel cubre 30 días y es la única red. Exportar el CSV
  antes de cada cierre.
- **La app no es multiusuario**: un solo `APP_PASSWORD` compartido, sin tabla de usuarios ni
  `user_id`. Convertirla implica tocar el modelo de datos entero y aislar cada query.
