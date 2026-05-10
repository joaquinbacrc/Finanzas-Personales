// Importador de CSV exportado desde la app vieja (Google Sheets).
// Uso: npx tsx src/scripts/import-csv.ts "Gastos - Mayo 2026.csv"
//
// Borra los gastos actuales en la DB y los reemplaza con los del CSV.
// También actualiza ingresos (sueldo / MP / NUBI), tenencia USD,
// tipo de cambio (USD y EUR), fecha de cierre de tarjeta y título del mes.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, setSettingValue, withTransaction } from '../db.js';

// --- Mini CSV parser (RFC 4180-ish, sin deps) ---
function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

const num = (v: string | undefined): number => {
  if (!v) return 0;
  const s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  // formato US (1234.56) o ES (1.234,56). Detectar por última coma vs último punto.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let cleaned: string;
  if (lastDot > lastComma) cleaned = s.replace(/,/g, '');
  else if (lastComma > lastDot) cleaned = s.replace(/\./g, '').replace(',', '.');
  else cleaned = s.replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

const cleanStr = (v: string | undefined): string => (v ?? '').trim();

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Falta el archivo CSV. Uso: npx tsx src/scripts/import-csv.ts "Gastos - Mayo 2026.csv"');
  process.exit(1);
}
const csvPath = resolve(process.cwd(), fileArg);
if (!existsSync(csvPath)) {
  console.error(`No encuentro el archivo: ${csvPath}`);
  process.exit(1);
}

console.log(`Leyendo ${csvPath}`);
const text = readFileSync(csvPath, 'utf8');
const rows = parseCSV(text);
console.log(`Filas leídas: ${rows.length}`);

// Mapeo a las posiciones del CSV exportado por la app vieja.
// El CSV tiene una columna vacía al inicio (col 0 vacía), todo se desplaza +1.
const TITULO   = cleanStr(rows[1]?.[1]);                            // fila 2, col B
const TC_FECHA = cleanStr(rows[3]?.[6]);                            // fila 4, col G
const TC_USD   = num(rows[4]?.[6]);                                 // fila 5, col G
const TC_EUR   = num(rows[4]?.[7]);                                 // fila 5, col H
const SUELDO   = num(rows[5]?.[3]);                                 // fila 6, col D
const MP       = num(rows[6]?.[3]);                                 // fila 7, col D
const NUBI     = num(rows[7]?.[3]);                                 // fila 8, col D
const CIERRE   = cleanStr(rows[7]?.[6]);                            // fila 8, col G
const USD      = num(rows[10]?.[6]);                                // fila 11, col G

// Gastos: fila 13 en adelante (índice 12)
type GIn = {
  fecha: string; motivo: string; monto_ars: number; moneda: string; monto_ext: number;
  imputar: string; tipo: string; cuota: string; categoria: string; estado: string; notas: string;
};
const gastos: GIn[] = [];
for (let i = 12; i < rows.length; i++) {
  const r = rows[i];
  if (!r) continue;
  const motivo = cleanStr(r[2]);
  if (!motivo) continue; // línea vacía
  const moneda = cleanStr(r[4]) || 'ARS';
  gastos.push({
    fecha:     cleanStr(r[1]),
    motivo,
    monto_ars: moneda === 'ARS' ? num(r[3]) : 0,
    moneda,
    monto_ext: moneda !== 'ARS' ? num(r[5]) : 0,
    imputar:   cleanStr(r[6]),
    tipo:      cleanStr(r[7]) || 'Variable',
    cuota:     cleanStr(r[8]),
    categoria: cleanStr(r[10]) || 'Otros',
    estado:    cleanStr(r[13]) || 'Pagado',
    notas:     cleanStr(r[14]),
  });
}

console.log(`Gastos detectados: ${gastos.length}`);
console.log(`Ingresos: Sueldo=${SUELDO}, MP=${MP}, NUBI=${NUBI}, USD=${USD}`);
console.log(`TC USD=${TC_USD} (fecha ${TC_FECHA}), TC EUR=${TC_EUR}, Cierre=${CIERRE}`);
console.log(`Título: ${TITULO}`);

withTransaction(() => {
  db.prepare(`DELETE FROM gastos`).run();
  const ins = db.prepare(`
    INSERT INTO gastos (fecha, motivo, monto_ars, moneda, monto_ext, imputar, tipo, cuota, categoria, estado, notas)
    VALUES (@fecha, @motivo, @monto_ars, @moneda, @monto_ext, @imputar, @tipo, @cuota, @categoria, @estado, @notas)
  `);
  for (const g of gastos) ins.run(g);

  db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 1`).run(SUELDO);
  db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 2`).run(MP);
  db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 3`).run(NUBI);

  if (TC_USD)   setSettingValue('tc_usd',   String(TC_USD));
  if (TC_EUR)   setSettingValue('tc_eur',   String(TC_EUR));
  if (TC_FECHA) setSettingValue('tc_fecha', TC_FECHA);
  if (CIERRE)   setSettingValue('cierre_tarjeta', CIERRE);
  setSettingValue('tenencia_usd', String(USD));
  if (TITULO)   setSettingValue('titulo', TITULO);
});

console.log(`✓ Importación completa. Refrescá la pestaña del navegador para ver los datos.`);
