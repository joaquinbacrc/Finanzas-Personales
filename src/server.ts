import express, { type Request, type Response, type NextFunction } from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as svc from './services/finanzas.js';
import { authMiddleware, loginHandler, logoutHandler, authEnabled } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../public');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.set('trust proxy', 1); // confiar en X-Forwarded-Proto (Railway)
app.use(express.json({ limit: '1mb' }));

// Healthcheck (público — para que el orquestador no necesite credenciales)
app.get('/api/health', (_req, res) => res.json({ ok: true, authEnabled }));

// Login endpoints (públicos, antes del middleware)
app.post('/api/login', loginHandler);
app.post('/api/logout', logoutHandler);

// Auth gate
app.use(authMiddleware);

app.use(express.static(PUBLIC_DIR));

// Wrap async handlers to forward errors
const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try { Promise.resolve(fn(req, res)).catch(next); }
  catch (e) { next(e); }
};

// --- Endpoints ---
app.get('/api/data', wrap((_req, res) => {
  res.json(svc.getAllData());
}));

app.post('/api/gastos', wrap((req, res) => {
  res.json(svc.agregarGasto(req.body));
}));

app.put('/api/gastos/:id', wrap((req, res) => {
  const g = { ...req.body, row: Number(req.params.id) };
  res.json(svc.editarGasto(g));
}));

app.delete('/api/gastos/:id', wrap((req, res) => {
  res.json(svc.eliminarGasto(Number(req.params.id)));
}));

app.post('/api/gastos/bulk-delete', wrap((req, res) => {
  const rows = (req.body?.rows ?? []) as number[];
  res.json(svc.eliminarGastosBulk(rows.map(Number)));
}));

app.post('/api/gastos/:id/estado', wrap((req, res) => {
  res.json(svc.toggleEstado(Number(req.params.id), String(req.body?.estado ?? 'Pagado')));
}));

app.post('/api/ingresos', wrap((req, res) => {
  const row = req.body?.row;
  const monto = Number(req.body?.monto);
  res.json(svc.editarIngreso(row, monto));
}));

app.post('/api/tc', wrap((req, res) => {
  res.json(svc.editarTC(Number(req.body?.tc)));
}));

app.post('/api/cierre-tarjeta', wrap((req, res) => {
  res.json(svc.editarCierreTarjeta(String(req.body?.fecha ?? '')));
}));

app.post('/api/rendimiento', wrap((req, res) => {
  res.json(svc.agregarRendimiento(String(req.body?.billetera ?? ''), Number(req.body?.monto)));
}));

app.post('/api/origenes', wrap((req, res) => {
  res.json(svc.saveOrigenes(req.body?.origenes ?? []));
}));

app.post('/api/categorias', wrap((req, res) => {
  res.json(svc.saveCategorias(req.body?.categorias ?? []));
}));

app.post('/api/plantillas', wrap((req, res) => {
  res.json(svc.savePlantillas(req.body?.plantillas ?? []));
}));

app.post('/api/presupuestos', wrap((req, res) => {
  res.json(svc.savePresupuestos(req.body?.presupuestos ?? {}));
}));

app.get('/api/cierre/preview', wrap((_req, res) => {
  res.json(svc.previewCierreMes());
}));

app.post('/api/cierre', wrap((req, res) => {
  res.json(svc.cerrarMes(String(req.body?.mes ?? ''), req.body?.anio, String(req.body?.fecha ?? '')));
}));

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api error]', err.message);
  res.status(400).json({ error: err.message || 'Error desconocido' });
});

app.listen(PORT, () => {
  console.log(`💰 Finanzas corriendo en http://localhost:${PORT}`);
});
