// Prueba el codigo del importador TAL COMO QUEDO en worker.js, con stubs de D1.
// Extrae el bloque real del archivo para no testear una copia que pueda divergir.
import fs from 'node:fs';

const WORKER = 'C:/Users/jsanchez/OneDrive/Joaquin/IA/10 SKILLS ADRI Y JUANPE/apps/01-Apps multiusuario/08-Finanzas/Finanzas-Personales/worker.js';
const XLSX = 'C:/Users/jsanchez/Downloads/Últimos consumos - Visa 5278.xlsx';

const src = fs.readFileSync(WORKER, 'utf8');
const ini = src.indexOf('// IMPORTADOR DE RESUMEN DE TARJETA');
const fin = src.indexOf('var worker_default = {');
if (ini === -1 || fin === -1) throw new Error('No encontre el bloque del importador en worker.js');
const bloque = src.slice(ini, fin);

// Stubs de lo que el bloque usa del resto del worker.
const preludio = `
const __name = (f) => f;
const num = (v) => { if (v == null || v === '') return 0; const n = Number(v); return isNaN(n) ? 0 : n; };
const arsEquivOf = (g, tc) => g.moneda === 'USD' ? num(g.monto_ext) * tc : num(g.monto_ars);
const rowToGasto = (r, tcUSD, tcEUR) => ({
  row: r.id, fecha: r.fecha, motivo: r.motivo, montoARS: num(r.monto_ars),
  moneda: r.moneda || 'ARS', montoExt: num(r.monto_ext),
  montoUSD: r.moneda === 'USD' ? num(r.monto_ext) : 0,
  imputar: r.imputar || '', tipo: r.tipo || 'Variable', cuota: r.cuota || '',
  arsEquiv: arsEquivOf(r, tcUSD), categoria: r.categoria || 'Otros',
  estado: r.estado || 'Pagado', notas: r.notas || ''
});
let __settings = { tc_usd: '1515', tc_eur: '1500', alias_tarjeta: '{}' };
let __gastos = [];
let __insertados = [];
const loadCierreState = async () => ({ settings: __settings, ingresos: {}, gastos: __gastos });
const setSettingValue = async (db, k, v) => { __settings[k] = v; };
`;

const epilogo = `
export { parsearResumenTarjeta, importarConsumos, extraerConsumos, leerXlsx, claveAlias };
export const __estado = () => ({ settings: __settings, insertados: __insertados });
export const __setGastos = (g) => { __gastos = g; };
export const __db = {
  prepare: (sql) => ({ bind: (...args) => ({ sql, args }) }),
  batch: async (stmts) => { __insertados.push(...stmts); return []; },
};
`;

const mod = preludio + bloque + epilogo;
const tmp = 'C:/Users/jsanchez/AppData/Local/Temp/claude/C--Users-jsanchez-OneDrive-Joaquin-IA-10-SKILLS-ADRI-Y-JUANPE-apps-01-Apps-multiusuario-08-Finanzas/332b665f-236b-4f5c-b72e-0f10b77c5c08/scratchpad/_worker_bloque.mjs';
fs.writeFileSync(tmp, mod);
const W = await import('file://' + tmp);

const buf = fs.readFileSync(XLSX);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

let fallas = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) fallas++;
  console.log((cond ? '  OK   ' : ' FALLA ') + msg + (extra ? '  ' + extra : ''));
};

// --- Gastos reales del mes en curso ---
const g = (id, motivo, ars, cuota, fecha, moneda = 'ARS', ext = 0, notas = '') =>
  ({ id, motivo, monto_ars: ars, cuota, fecha, moneda, monto_ext: ext, notas, tipo: 'Fijo', categoria: 'Otros' });
W.__setGastos([
  g(235, 'Celular', 68017, '6/18', '01/08/2026'), g(236, 'Curso Blockchain', 106944, '8/9', '01/08/2026'),
  g(237, 'Internet', 105250.29, '', '01/08/2026'), g(238, 'Seguro auto', 70656.38, '', '01/08/2026'),
  g(240, 'Patente', 35296.1, '', '01/08/2026'), g(241, 'Luz', 20743.72, '', '01/08/2026'),
  g(242, 'Gas', 14364.15, '', '01/08/2026'), g(243, 'Municipalidad', 15990, '', '01/08/2026'),
  g(244, 'Meli+', 3490, '', '01/08/2026'), g(253, 'Cambio cubiertas', 72500, '3/12', '01/08/2026'),
  g(250, 'Cloudflare', 0, '', '01/08/2026', 'USD', 5), g(254, 'Google One', 0, '', '01/08/2026', 'USD', 9.99),
]);

console.log('\n=== 1. parseo y cuadre contra el subtotal del banco ===');
const r = await W.parsearResumenTarjeta(W.__db, ab);
ok(r.cuadra === true, 'la suma cuadra con el subtotal del banco', `(ARS ${r.sumaARS} vs ${r.totales.ars})`);
ok(r.consumos.length === 59, 'extrajo 59 consumos', `(${r.consumos.length})`);
ok(r.pagos.length === 3, 'excluyo los 3 pagos/devoluciones', `(${r.pagos.length})`);
ok(r.cierre === '27/08/2026', 'leyo la fecha de cierre', `(${r.cierre})`);

console.log('\n=== 2. matching ===');
const dup = r.consumos.filter(c => c.estado === 'posible_duplicado');
ok(dup.length >= 10, 'detecta los gastos ya cargados', `(${dup.length} posibles duplicados)`);
ok(dup.every(c => c.matchId != null), 'todos los match traen matchId (no undefined)');
const arba = r.consumos.find(c => /arba/i.test(c.descripcion));
ok(arba && arba.matchMotivo === 'Patente', 'Www.arba.gov.ar -> Patente', `(${arba && arba.matchMotivo})`);
const anth = r.consumos.find(c => /anthropic/i.test(c.descripcion));
ok(anth && anth.confianza !== 'alta', 'Anthropic U$S5 NO se da por seguro (nombre distinto)', `(${anth && anth.confianza})`);
const cf = r.consumos.find(c => /^cloudflare/i.test(c.descripcion));
ok(cf && cf.confianza === 'alta', 'Cloudflare -> Cloudflare si es alta (nombre coincide)', `(${cf && cf.confianza})`);
const tele = r.consumos.find(c => /telecentro/i.test(c.descripcion));
ok(tele && tele.estado === 'nuevo', 'Telecentro NO matchea con el curso (falso positivo evitado)', `(${tele && tele.estado})`);

console.log('\n=== 3. importar: ancla y alias ===');
const aImportar = [
  { ...r.consumos.find(c => /arba/i.test(c.descripcion)), motivo: 'Patente', categoria: 'Hogar', tipo: 'Fijo', imputar: 'VISA 5278' },
  { ...r.consumos.find(c => /naturgy/i.test(c.descripcion)), motivo: 'Gas', categoria: 'Hogar', tipo: 'Fijo', imputar: 'VISA 5278' },
];
const res = await W.importarConsumos(W.__db, aImportar);
ok(res.importados === 2, 'inserto los 2 consumos', `(${res.importados})`);
const est = W.__estado();
const notas = est.insertados.map(i => i.args[10]);
ok(notas.every(n => /\[tarjeta:\d+\|/.test(n)), 'las notas llevan el ancla [tarjeta:comprobante|descripcion]');
console.log('       nota guardada:', JSON.stringify(notas[0]));
const alias = JSON.parse(est.settings.alias_tarjeta);
ok(Object.keys(alias).length === 2, 'aprendio 2 alias', `(${Object.keys(alias).length})`);
console.log('       alias:', JSON.stringify(alias));

console.log('\n=== 4. el alias manda en la segunda importacion ===');
W.__setGastos([]);   // sin gastos cargados: el alias tiene que aportar igual
const r2 = await W.parsearResumenTarjeta(W.__db, ab);
const arba2 = r2.consumos.find(c => /arba/i.test(c.descripcion));
ok(arba2 && arba2.motivoSugerido === 'Patente', 'la 2da vez sugiere el nombre QUE YO ESCRIBI', `(${arba2 && arba2.motivoSugerido})`);
ok(arba2 && arba2.categoria === 'Hogar' && arba2.tipo === 'Fijo' && arba2.imputar === 'VISA 5278',
   'y tambien autocompleta categoria, tipo y origen');

console.log('\n=== 5. dedup por comprobante ===');
W.__setGastos([{ id: 999, motivo: 'Patente', monto_ars: 35296.1, moneda: 'ARS', monto_ext: 0, cuota: '', fecha: '06/08/2026', notas: notas[0] }]);
const r3 = await W.parsearResumenTarjeta(W.__db, ab);
const arba3 = r3.consumos.find(c => /arba/i.test(c.descripcion));
ok(arba3 && arba3.estado === 'ya_cargado', 'reconoce por comprobante que YA lo importe', `(${arba3 && arba3.estado})`);

console.log('\n' + (fallas ? `*** ${fallas} FALLAS ***` : 'TODAS LAS PRUEBAS PASAN'));
process.exit(fallas ? 1 : 0);
