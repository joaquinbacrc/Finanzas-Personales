# Roadmap — Migración del resto de las apps a Cloudflare

> **Estado**: planificado, NO iniciado. El usuario explícitamente dijo "no ahora" — no arrancar hasta que lo pida con un mensaje tipo "arranquemos el roadmap" o equivalente.

## Contexto

El usuario tiene 8 apps adicionales en Google Apps Script (carpetas `../01-` a `../09-`, excepto `08-Finanzas` que ya está migrada):

| Carpeta | Lo que aparenta ser |
|---|---|
| 01-Control de Stock | Inventario / stock |
| 02-Cumpleaños | Recordatorios |
| 03-Producción | Procesos productivos |
| 04-Proyectos Excelencia | Gestión de proyectos |
| 05-Mantenimiento | Tareas de mantenimiento |
| 06-Arte | (a investigar) |
| 07-Areas | (a investigar) |
| 09-Merma | Pérdidas / desperdicio |

(Verificar contenido real de cada carpeta antes de planificar.)

## Decisión arquitectónica del usuario

- **Apps separadas** (NO una sola super-app). Cada una con su URL propia.
- **Conectadas vía datos compartidos**: lo cargado en una app debe poder verse en otra (ej: stock cargado en "Control de Stock" se refleja en "Producción").
- **Multi-usuario**: varios usuarios distintos, cada uno con su acceso.
- **Estilo premium consistente**: que todas se vean parecidas y mantengan la calidad visual del original.
- **Gratis y duradero**: por eso eligió Cloudflare (Workers + D1 + Pages) sobre Railway.

## Arquitectura propuesta

```
┌──────────────────────────────────────┐
│  hub.tudominio.com  (CF Pages)       │ ← Página índice con menú
└──────────────────────────────────────┘
        │
        ├─→ finanzas.tudominio.com   (CF Worker + Pages)
        ├─→ stock.tudominio.com      (CF Worker + Pages)
        ├─→ produccion.tudominio.com (CF Worker + Pages)
        └─→ ... etc
                │
                ▼
       ┌──────────────────┐
       │  D1 compartida   │ ← Una sola DB, tablas separadas por app + tablas comunes
       │  (SQLite gestion.)│
       └──────────────────┘
                │
                ▼
       ┌──────────────────┐
       │  CF Access       │ ← Login con Google, gratis hasta 50 users
       │  (multi-user)    │
       └──────────────────┘
```

### Componentes

- **Cloudflare Workers**: backend de cada app (sustituye a Express + Node).
- **Cloudflare D1**: SQLite gestionado, compartido entre Workers. La migración del schema actual de Finanzas es directa (D1 es SQL casi idéntico a SQLite estándar, con limitaciones menores en operaciones masivas).
- **Cloudflare Pages**: frontend estático de cada app + el hub principal.
- **Cloudflare Access**: gateway de auth con Google login. Sin escribir código de auth — definís políticas (qué emails pueden entrar a qué app).
- **Librería compartida de UI**: paquete con CSS + componentes que importa cada app, garantiza estilo consistente.

## Lo que el usuario debe decidir antes de arrancar

1. **Dominio propio** (recomendado, ~$10 USD/año en Cloudflare Registrar). Sin él funciona con `*.pages.dev` gratis pero sin URLs bonitas.
2. **Lista de usuarios** (emails de Google de cada persona).
3. **Permisos**: quién puede entrar a qué app, y con qué rol (lector, editor, admin).
4. **Mapeo de datos compartidos**: tablas comunes entre apps (ej: una tabla `clientes` que usen Finanzas, Stock y Producción).

## Esfuerzo estimado

- Diseño + setup inicial de Cloudflare: 1 sesión (~2-3h)
- Migración de cada app: 1-2h por app, según complejidad
- Total: ~15-20h de trabajo bien distribuido en varias sesiones

## Plan de migración cuando arranquemos

1. **Sesión de diseño**: entender qué datos comparte cada app, qué usuarios hay, qué permisos. (Sin código.)
2. **Setup base**: dominio, Cloudflare account, D1, Access, primer Worker de prueba.
3. **Librería compartida de UI**: extraer los estilos comunes del index.html actual a un paquete reutilizable.
4. **Migrar Finanzas a Cloudflare** (la más conocida, sirve de plantilla). El Railway queda como respaldo o se apaga.
5. **Migrar el resto, una por una**: siempre en este orden — investigar la app actual → diseñar el schema → portar el backend → portar el frontend → testear → deployar.

## NO confundir esto con

- "Una super-app multi-módulo" — fue rechazada por el usuario. Cada app debe estar separada.
- "Mantener todas en Apps Script" — es lo que el usuario tiene HOY pero quiere mover por velocidad y modernidad.

## Apps que NO se migrarían

Si alguna app tiene dependencias específicas de Google (ej: usa Gmail, Calendar, Drive de forma nativa), considerarlo: Apps Script tiene acceso directo y gratis a esos servicios; reemplazarlo en Cloudflare requiere usar las APIs de Google (más complejo). Evaluar caso por caso.
