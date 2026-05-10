import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DB path configurable por env (en producción/Railway: /data/finanzas.db sobre un volumen).
const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(__dirname, '../data/finanzas.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const DEFAULT_ORIGENES = ['VISA 5278', 'VISA 4305', 'Obligación Fija', 'MP', 'NUBI', 'Caja USD'];
const DEFAULT_CATEGORIAS = ['Comida', 'Transporte', 'Hogar', 'Suscripciones', 'Salud', 'Ocio', 'Compras', 'Otros'];

db.exec(`
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

// Seed inicial
const setSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
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

const seedIngreso = db.prepare(`INSERT OR IGNORE INTO ingresos (id, concepto, monto) VALUES (?, ?, ?)`);
seedIngreso.run(1, 'Sueldo', 0);
seedIngreso.run(2, 'MP', 0);
seedIngreso.run(3, 'NUBI', 0);

export function getSetting(key: string): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setSettingValue(key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

// Helper de transacción (node:sqlite no expone db.transaction como better-sqlite3).
export function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
