import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DB path configurable por env (en producción/Railway: /data/finanzas.db sobre un volumen).
export const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(__dirname, '../data/finanzas.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

const DEFAULT_ORIGENES = ['VISA 5278', 'VISA 4305', 'Obligación Fija', 'MP', 'NUBI', 'Caja USD'];
const DEFAULT_CATEGORIAS = ['Comida', 'Transporte', 'Hogar', 'Suscripciones', 'Salud', 'Ocio', 'Compras', 'Otros'];

let _db: DatabaseSync;

function openDb() {
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      motivo TEXT NOT NULL,
      monto_ars REAL DEFAULT 0,
      moneda TEXT DEFAULT 'ARS',
      monto_ext REAL DEFAULT 0,
      imputar TEXT DEFAULT '',
      tipo TEXT DEFAULT 'Variable',
      cuota TEXT DEFAULT '',
      categoria TEXT DEFAULT 'Otros',
      estado TEXT DEFAULT 'Pagado',
      notas TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_gastos_imputar ON gastos(imputar);
    CREATE INDEX IF NOT EXISTS idx_gastos_categoria ON gastos(categoria);
    CREATE INDEX IF NOT EXISTS idx_gastos_tipo ON gastos(tipo);

    CREATE TABLE IF NOT EXISTS ingresos (
      id INTEGER PRIMARY KEY,
      concepto TEXT NOT NULL,
      monto REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mes TEXT NOT NULL,
      ingresos REAL,
      gastos REAL,
      margen REAL,
      pct_variable REAL,
      sobrante_nubi REAL,
      sobrante_mp REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // Seeds idempotentes (INSERT OR IGNORE no pisa lo existente).
  const setSetting = _db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  const seedSettings: [string, string][] = [
    ['titulo', 'Finanzas — Mes actual'],
    ['tc_usd', '1400'],
    ['tc_eur', '1500'],
    ['tc_fecha', ''],
    ['cierre_tarjeta', ''],
    ['tenencia_usd', '0'],
    ['origenes', JSON.stringify(DEFAULT_ORIGENES)],
    ['categorias', JSON.stringify(DEFAULT_CATEGORIAS)],
    ['plantillas', '[]'],
    ['presupuestos', '{}'],
  ];
  for (const [k, v] of seedSettings) setSetting.run(k, v);

  const seedIngreso = _db.prepare(`INSERT OR IGNORE INTO ingresos (id, concepto, monto) VALUES (?, ?, ?)`);
  seedIngreso.run(1, 'Sueldo', 0);
  seedIngreso.run(2, 'MP', 0);
  seedIngreso.run(3, 'NUBI', 0);
}

openDb();

// Proxy: el resto del código importa `db` y sigue llamando .prepare(), .exec()...
// Cuando reabrimos la DB internamente, esos métodos se resuelven al nuevo handle.
export const db = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const val = (_db as any)[prop];
    return typeof val === 'function' ? val.bind(_db) : val;
  },
});

export function getSetting(key: string): string {
  const row = _db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setSettingValue(key: string, value: string): void {
  _db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function withTransaction<T>(fn: () => T): T {
  _db.exec('BEGIN');
  try {
    const out = fn();
    _db.exec('COMMIT');
    return out;
  } catch (e) {
    _db.exec('ROLLBACK');
    throw e;
  }
}

// Reemplaza el archivo SQLite con `buffer` y reabre la conexión.
// Validación: el header de un archivo SQLite v3 es 'SQLite format 3\0'.
export function importDbFile(buffer: Buffer): { rows: number } {
  const header = buffer.subarray(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('El archivo no parece una base SQLite válida');
  }
  try { _db.close(); } catch { /* noop */ }
  // Limpia archivos auxiliares (-shm, -wal) para evitar lecturas inconsistentes.
  for (const ext of ['-shm', '-wal', '-journal']) {
    try { writeFileSync(DB_PATH + ext, Buffer.alloc(0)); } catch { /* noop */ }
  }
  writeFileSync(DB_PATH, buffer);
  openDb();
  const r = _db.prepare(`SELECT COUNT(*) as c FROM gastos`).get() as { c: number } | undefined;
  return { rows: r?.c ?? 0 };
}
