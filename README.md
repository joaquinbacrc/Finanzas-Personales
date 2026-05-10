# Finanzas — Node.js

App de finanzas personales premium. Migración del proyecto original (Google Apps Script + Google Sheets) a un stack moderno de Node.js con persistencia local.

> 🔵 **Si abrís este repo con Claude Code**, leé primero [CLAUDE.md](CLAUDE.md) — tiene todo el contexto de decisiones, deploy actual y plan futuro.

## Estado actual

- ✅ **En producción**: https://finanzas-personales-production-fec6.up.railway.app
- ✅ Deployada en Railway con Dockerfile + volumen persistente
- ✅ Datos reales de Mayo 2026 cargados (importados del Sheet original)
- ✅ Multi-device: PWA instalable en iPhone/Android
- 📅 **Plan futuro**: ver [ROADMAP.md](ROADMAP.md) — migración a Cloudflare con multi-app + multi-user.

## Stack

- **Runtime**: Node.js 24 (requiere `>= 22.5` por el módulo `node:sqlite` built-in)
- **Backend**: Express + TypeScript (módulos ESM)
- **DB**: SQLite vía `node:sqlite` (built-in, sin dependencias nativas, sin necesidad de Python ni compilación)
- **Frontend**: HTML + CSS + JS vanilla (la UI premium del proyecto original, intacta — Fraunces / Inter / JetBrains Mono, modo claro/oscuro, mobile-first)
- **Dev tooling**: tsx (hot-reload TypeScript)

## Cómo correrlo

```bash
# 1. Instalar deps (una sola vez)
npm install

# 2. Modo dev (hot reload)
npm run dev

# 3. Producción
npm run build && npm start
```

Abrir http://localhost:3000

La base de datos SQLite vive en `./data/finanzas.db`. Se crea sola la primera vez que arranca el server, con seeds por defecto (orígenes de pago, categorías, tipo de cambio inicial 1400 ARS/USD).

## Estructura

```
08-finanzas-node/
├── public/
│   └── index.html          ← Frontend completo (UI original adaptada)
├── src/
│   ├── server.ts           ← Express + endpoints REST
│   ├── db.ts               ← Schema, seeds, helpers de transacción
│   └── services/
│       └── finanzas.ts     ← Lógica de negocio (porteo de Code.gs)
├── data/
│   └── finanzas.db         ← SQLite (auto-creado, ignorado por git)
├── package.json
├── tsconfig.json
└── README.md
```

## Endpoints

| Método | Path | Descripción |
|---|---|---|
| GET | `/api/data` | Estado completo (gastos, ingresos, dashboard, config) |
| POST | `/api/gastos` | Alta de gasto |
| PUT | `/api/gastos/:id` | Editar gasto |
| DELETE | `/api/gastos/:id` | Eliminar gasto |
| POST | `/api/gastos/bulk-delete` | `{ rows: number[] }` — eliminar varios |
| POST | `/api/gastos/:id/estado` | `{ estado }` — toggle Pagado/Pendiente |
| POST | `/api/ingresos` | `{ row, monto }` — editar sueldo / MP / NUBI / USD |
| POST | `/api/tc` | `{ tc }` — actualizar tipo de cambio USD |
| POST | `/api/cierre-tarjeta` | `{ fecha }` — set fecha de cierre |
| POST | `/api/rendimiento` | `{ billetera, monto }` — sumar rendimiento |
| POST | `/api/origenes` | `{ origenes: string[] }` — guardar lista |
| POST | `/api/categorias` | `{ categorias: string[] }` |
| POST | `/api/plantillas` | `{ plantillas: [...] }` |
| POST | `/api/presupuestos` | `{ presupuestos: { categoría: monto } }` |
| GET | `/api/cierre/preview` | Resumen previo al cierre de mes |
| POST | `/api/cierre` | `{ mes, anio, fecha }` — ejecuta cierre |

## Cambios respecto al original

- **Persistencia**: Google Sheet → SQLite local. El archivo `data/finanzas.db` es portable (podés copiarlo, hacer backup, sincronizarlo por Dropbox/Drive si querés multi-device).
- **Frontend**: el HTML/CSS quedó idéntico. La capa de comunicación cambió de `google.script.run.X(args)` a `fetch('/api/...')`. Hay un shim que mantiene la API original para no tocar el código de la UI.
- **`g.row`** ahora es el `id` de SQLite (autoincrement), no la fila de la planilla. Funciona igual desde el frontend porque solo se usa como ID estable.
- **`agregarRendimiento`**: cuando billetera ≠ MP/NUBI, suma a `tenencia_usd`.
- **Cierre de mes**: hace todo en una transacción atómica. No genera "backup sheet" porque ya tenés `historico` (tabla aparte) y el archivo SQLite completo es respaldable.

## Quick-add por URL

Igual que el original — abrir con query params para pre-llenar el formulario:

```
http://localhost:3000/?motivo=Uber&monto=5000&imputar=MP&tipo=Variable&categoria=Transporte
```

Útil para Shortcuts de iOS / Android.

## Atajos de teclado

- `1`–`5`: cambiar de vista
- `N`: nuevo gasto
- `/`: buscar
- `Esc`: cerrar modal / salir de modo selección

## Backup

Apagá el server y copiá la carpeta `data/`. Es todo. Para restaurar, sobrescribí.
