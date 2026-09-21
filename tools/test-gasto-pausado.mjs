// Prueba que un gasto "Pausado" no cuente en NINGUN total, y que al cerrar el mes vuelva
// activo. Extrae el codigo REAL de worker.js (no una copia) y lo corre con un db falso.
//
// Correr:  node tools/test-gasto-pausado.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(raiz, 'worker.js'), 'utf8');

// Desde el helper esPausado hasta el importador: ahi viven rowToGasto, computeDashboard,
// loadCierreState, previewCierreMes y cerrarMes.
// Arranca en arsEquivOf, que rowToGasto necesita y vive justo antes del helper.
const ini = src.indexOf('var arsEquivOf');
if (ini === -1) throw new Error('No encontre arsEquivOf en worker.js');
let fin = src.indexOf('// IMPORTADOR DE RESUMEN DE TARJETA');
if (fin === -1) fin = src.indexOf('var worker_default = {');
const bloque = src.slice(ini, fin);

// setSettingValue vive ANTES del bloque extraido, asi que hay que stubearla.
// loadCierreState NO se stubea: entra en el bloque y se usa la de verdad contra el db falso.
const preludio = [
  'const __name = (f) => f;',
  "const num = (v) => { if (v == null || v === '') return 0; const n = Number(v); return isNaN(n) ? 0 : n; };",
  'let __settings = { tc_usd: "1500", tc_eur: "1600", titulo: "FIN Septiembre 2026", cierre_tarjeta: "", tenencia_usd: "0" };',
  'let __ingresosRows = [{ id: 1, monto: 1000000 }, { id: 2, monto: 500000 }, { id: 3, monto: 200000 }];',
  'let __gastos = []; let __insertados = []; let __borrados = [];',
  'const setSettingValue = async (db, k, v) => { __settings[k] = v; };',
  '',
].join('\n');

const epilogo = [
  '',
  'export { computeDashboard, previewCierreMes, cerrarMes, esPausado, rowToGasto };',
  'export const __set = (g) => { __gastos = g; __insertados = []; __borrados = []; };',
  'export const __ins = () => __insertados;',
  'export const __borr = () => __borrados;',
  'export const __db = {',
  '  prepare: (sql) => ({',
  '    all: async () => {',
  '      if (/FROM settings/i.test(sql)) return { results: Object.entries(__settings).map(([key, value]) => ({ key, value })) };',
  '      if (/FROM ingresos/i.test(sql)) return { results: __ingresosRows };',
  '      if (/FROM gastos/i.test(sql)) return { results: __gastos };',
  '      return { results: [] };',
  '    },',
  '    bind: (...a) => ({ sql, a, run: async () => {',
  '      if (/DELETE/i.test(sql)) __borrados.push(...a);',
  '      return { meta: { changes: a.length } };',
  '    } }),',
  '    run: async () => ({ meta: { changes: 0 } }),',
  '  }),',
  '  batch: async (stmts) => {',
  '    for (const s of stmts || []) if (s && /INSERT INTO gastos/i.test(s.sql || "")) __insertados.push(s.a);',
  '    return [];',
  '  },',
  '};',
].join('\n');

const tmp = path.join(raiz, 'tools', '_pausado_tmp.mjs');
fs.writeFileSync(tmp, preludio + bloque + epilogo);
const W = await import('file://' + tmp.replace(/\\/g, '/'));

let fallas = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) fallas++;
  console.log((cond ? '  OK   ' : ' FALLA ') + msg + (extra ? '   → ' + extra : ''));
};

// 3 fijos + 1 variable, montos redondos para que las cuentas canten solas.
const G = (id, motivo, ars, tipo, imputar, estado = 'Pagado', cuota = '') =>
  ({ id, motivo, monto_ars: ars, moneda: 'ARS', monto_ext: 0, tipo, imputar, estado, cuota,
     fecha: '01/09/2026', categoria: 'Hogar', notas: '' });

const base = [
  G(1, 'Alquiler', 400000, 'Fijo', 'VISA 5278'),
  G(2, 'Internet', 100000, 'Fijo', 'MP'),
  G(3, 'Gimnasio', 50000, 'Fijo', 'NUBI'),
  G(4, 'Super', 30000, 'Variable', 'MP'),
];
const aGastos = (rows) => rows.map((r) => W.rowToGasto(r, 1500, 1600));

// computeDashboard(gastos, ingresos, tenenciaUSD, tcUSD, cierreStr, historico)
// `ingresos` es un array de objetos con .monto -> [sueldo, mp, nubi]
const ING = [{ monto: 1000000 }, { monto: 500000 }, { monto: 200000 }];

console.log('=== 1. el pausado no suma en el dashboard ===');
const antes = W.computeDashboard(aGastos(base), ING, 0, 1500, '', []);
const conPausa = base.map((g) => (g.id === 2 ? { ...g, estado: 'Pausado' } : g));
const desp = W.computeDashboard(aGastos(conPausa), ING, 0, 1500, '', []);

ok(antes.totalGastos === 580000, 'con todo activo el total es 580.000', String(antes.totalGastos));
ok(desp.totalGastos === 480000, 'al pausar Internet (100.000) queda 480.000', String(desp.totalGastos));
ok(desp.totalGastos === antes.totalGastos - 100000, 'baja EXACTAMENTE el monto pausado');
ok(desp.margen === antes.margen + 100000, 'el margen sube exactamente lo mismo',
   antes.margen + ' -> ' + desp.margen);
ok(desp.saldoMP === antes.saldoMP + 100000, 'se libera el saldo de MP, que es su billetera');
ok(desp.saldoNUBI === antes.saldoNUBI, 'las otras billeteras no se tocan');
ok(desp.gastosFijos === antes.gastosFijos - 100000, 'baja el total de Fijos');
ok(desp.gastosVariables === antes.gastosVariables, 'los Variables quedan igual');
ok(desp.disponibleTarjeta === antes.disponibleTarjeta, 'la tarjeta no cambia (Internet era MP)');

console.log('\n=== 2. ida y vuelta sin deriva ===');
const vuelta = W.computeDashboard(aGastos(base), ING, 0, 1500, '', []);
ok(JSON.stringify(vuelta) === JSON.stringify(antes), 'despausar deja el dashboard IDENTICO');

console.log('\n=== 3. el preview del cierre muestra lo que se va a cerrar ===');
W.__set(conPausa);
const prev = await W.previewCierreMes(W.__db);
ok(prev.totalGastos === 480000, 'el preview excluye el pausado', String(prev.totalGastos));

console.log('\n=== 4. cerrarMes: no suma al historico pero SI devuelve el fijo ===');
W.__set(conPausa);
const res = await W.cerrarMes(W.__db, 'Octubre', 2026, '');
ok(res && res.success === true, 'el cierre NO aborta (el pausado sigue en idsContabilizados)');

const ins = W.__ins();
const motivos = ins.map((a) => a[1]);
ok(ins.length === 3, 'se reinsertan los 3 Fijos, pausado incluido', motivos.join(', '));
ok(motivos.includes('Internet'), 'el fijo pausado VUELVE al mes nuevo');
ok(!motivos.includes('Super'), 'el Variable no vuelve, como siempre');
const net = ins.find((a) => a[1] === 'Internet');
ok(net && net[9] === 'Pendiente', 'y vuelve ACTIVO (Pendiente), o sea despausado', net && net[9]);
ok(W.__borr().length === 4, 'se borran los 4 gastos del mes viejo, pausado incluido',
   String(W.__borr().length));

console.log('\n=== 5. la cuota avanza igual aunque este pausado ===');
W.__set([
  G(1, 'Celular', 68000, 'Fijo', 'VISA 5278', 'Pausado', '6/18'),
  G(2, 'Curso', 100000, 'Fijo', 'VISA 5278', 'Pagado', '3/9'),
]);
await W.cerrarMes(W.__db, 'Octubre', 2026, '');
const ins2 = W.__ins();
const cel = ins2.find((a) => a[1] === 'Celular');
const cur = ins2.find((a) => a[1] === 'Curso');
// Pausar no significa que el gasto no se pague: el plan de cuotas sigue su curso igual,
// pausar solo lo saca del total del mes.
ok(cel && cel[7] === '7/18', 'el pausado TAMBIEN avanza la cuota: 6/18 -> 7/18', cel && cel[7]);
ok(cur && cur[7] === '4/9', 'el activo avanza igual: 3/9 -> 4/9', cur && cur[7]);

fs.unlinkSync(tmp);
console.log('\n' + (fallas ? '*** ' + fallas + ' FALLAS ***' : 'TODAS LAS PRUEBAS PASAN'));
process.exit(fallas ? 1 : 0);
