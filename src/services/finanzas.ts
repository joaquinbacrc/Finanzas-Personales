import { db, getSetting, setSettingValue, withTransaction } from '../db.js';

export type Gasto = {
  row: number;          // id (mantengo el nombre `row` para compatibilidad con el frontend original)
  fecha: string;        // DD/MM/YYYY
  motivo: string;
  montoARS: number;
  moneda: string;       // ARS | USD | EUR
  montoExt: number;
  montoUSD: number;
  imputar: string;
  tipo: string;         // Fijo | Variable
  cuota: string;
  arsEquiv: number;
  categoria: string;
  estado: string;       // Pagado | Pendiente
  notas: string;
};

export type Ingreso = { row: number; concepto: string; monto: number };

export type Plantilla = {
  motivo: string;
  moneda: string;
  montoARS: number;
  montoExt: number;
  imputar: string;
  tipo: string;
  categoria: string;
  cuota: string;
  notas: string;
};

export type HistoricoRow = {
  mes: string;
  ingresos: number;
  gastos: number;
  margen: number;
  pctVariable: number;
  sobranteNUBI: number;
  sobranteMP: number;
};

const num = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const arsEquiv = (g: { moneda: string; monto_ars: number; monto_ext: number }, tcUSD: number, tcEUR: number): number => {
  if (g.moneda === 'USD') return num(g.monto_ext) * tcUSD;
  if (g.moneda === 'EUR') return num(g.monto_ext) * tcEUR;
  return num(g.monto_ars);
};

type GastoRow = {
  id: number;
  fecha: string;
  motivo: string;
  monto_ars: number;
  moneda: string;
  monto_ext: number;
  imputar: string;
  tipo: string;
  cuota: string;
  categoria: string;
  estado: string;
  notas: string;
};

const rowToGasto = (r: GastoRow, tcUSD: number, tcEUR: number): Gasto => ({
  row: r.id,
  fecha: r.fecha,
  motivo: r.motivo,
  montoARS: num(r.monto_ars),
  moneda: r.moneda || 'ARS',
  montoExt: num(r.monto_ext),
  montoUSD: r.moneda === 'USD' ? num(r.monto_ext) : 0,
  imputar: r.imputar || '',
  tipo: r.tipo || 'Variable',
  cuota: r.cuota || '',
  arsEquiv: arsEquiv(r, tcUSD, tcEUR),
  categoria: r.categoria || 'Otros',
  estado: r.estado || 'Pagado',
  notas: r.notas || '',
});

export function getAllData() {
  const tcUSD = num(getSetting('tc_usd')) || 1400;
  const tcEUR = num(getSetting('tc_eur')) || 1500;
  const tcFecha = getSetting('tc_fecha');
  const cierreTarjeta = getSetting('cierre_tarjeta');
  const tenenciaUSD = num(getSetting('tenencia_usd'));
  const titulo = getSetting('titulo') || 'Finanzas';

  const ingresosRows = db.prepare(`SELECT id, concepto, monto FROM ingresos ORDER BY id`).all() as { id: number; concepto: string; monto: number }[];
  const ingresos: Ingreso[] = ingresosRows.map(r => ({ row: r.id, concepto: r.concepto, monto: num(r.monto) }));

  const gastosRows = db.prepare(`SELECT * FROM gastos ORDER BY id`).all() as GastoRow[];
  const gastos: Gasto[] = gastosRows.map(r => rowToGasto(r, tcUSD, tcEUR));

  const histRows = db.prepare(`SELECT mes, ingresos, gastos, margen, pct_variable, sobrante_nubi, sobrante_mp FROM historico ORDER BY id`).all() as {
    mes: string; ingresos: number; gastos: number; margen: number; pct_variable: number; sobrante_nubi: number; sobrante_mp: number;
  }[];
  const historico: HistoricoRow[] = histRows.map(r => ({
    mes: r.mes, ingresos: num(r.ingresos), gastos: num(r.gastos), margen: num(r.margen),
    pctVariable: num(r.pct_variable), sobranteNUBI: num(r.sobrante_nubi), sobranteMP: num(r.sobrante_mp),
  }));

  const dashboard = computeDashboard(gastos, ingresos, tenenciaUSD, tcUSD, cierreTarjeta, historico);
  const origenes: string[] = JSON.parse(getSetting('origenes') || '[]');
  const categorias: string[] = JSON.parse(getSetting('categorias') || '[]');
  const plantillas: Plantilla[] = JSON.parse(getSetting('plantillas') || '[]');

  return {
    titulo,
    tc: tcUSD,
    tcEUR,
    tcFecha,
    cierreTarjeta,
    ingresos,
    gastos,
    categorias,
    origenes,
    tipos: ['Fijo', 'Variable'],
    dashboard,
    historico,
    plantillas,
  };
}

function computeDashboard(gastos: Gasto[], ingresos: Ingreso[], tenenciaUSD: number, tcUSD: number, cierreStr: string, historico: HistoricoRow[]) {
  const sueldo = ingresos[0]?.monto ?? 0;
  const mp = ingresos[1]?.monto ?? 0;
  const nubi = ingresos[2]?.monto ?? 0;
  const sueldoMP = sueldo + mp;
  const totalIngresos = sueldo + mp + nubi + (tenenciaUSD * tcUSD);

  let tarjOblig = 0, gMP = 0, gNUBI = 0, gUSD_USD = 0, total = 0, fijos = 0, variables = 0;
  for (const g of gastos) {
    const v = g.arsEquiv;
    total += v;
    if (g.imputar === 'VISA 5278' || g.imputar === 'VISA 4305' || g.imputar === 'Obligación Fija') tarjOblig += v;
    if (g.imputar === 'MP') gMP += v;
    if (g.imputar === 'NUBI') gNUBI += v;
    if (g.imputar === 'Caja USD') gUSD_USD += (g.moneda === 'USD' ? g.montoExt : v / (tcUSD || 1));
    if (g.tipo === 'Fijo') fijos += v;
    if (g.tipo === 'Variable') variables += v;
  }

  const margen = totalIngresos - total;
  let diasHastaCierre = 0, pptoDia = 0;
  if (cierreStr && cierreStr.includes('/')) {
    const p = cierreStr.split('/');
    if (p.length === 3) {
      // HOY CUENTA: si el cierre es mañana, quedan hoy y mañana = 2 días. Antes se hacía
      // cierre - hoy, daba 1 y duplicaba el ppto diario. Mismo criterio en worker.js, que
      // además fuerza la zona horaria del usuario porque corre en UTC.
      const cierreDate = new Date(parseInt(p[2]!), parseInt(p[1]!) - 1, parseInt(p[0]!));
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0); cierreDate.setHours(0, 0, 0, 0);
      diasHastaCierre = Math.max(Math.round((cierreDate.getTime() - hoy.getTime()) / 86400000) + 1, 1);
      pptoDia = Math.round(margen / diasHastaCierre);
    }
  }

  const gastosMesAnterior = historico.length ? num(historico[historico.length - 1]!.gastos) : 0;

  return {
    sueldoMP, gastosTarjOblig: Math.round(tarjOblig), disponibleTarjeta: Math.round(sueldoMP - tarjOblig),
    tenenciaMP: mp, gastosMP: Math.round(gMP), saldoMP: Math.round(mp - gMP),
    ingresoNUBI: nubi, gastosNUBI: Math.round(gNUBI), saldoNUBI: Math.round(nubi - gNUBI),
    tenenciaUSD, gastosCajaUSD_USD: gUSD_USD, saldoUSD: tenenciaUSD - gUSD_USD,
    totalIngresos, totalGastos: Math.round(total), gastosMesAnterior,
    margen: Math.round(margen), pctMargen: totalIngresos > 0 ? (margen / totalIngresos * 100).toFixed(1) : '0.0',
    gastosFijos: Math.round(fijos), gastosVariables: Math.round(variables),
    pctVariable: total > 0 ? (variables / total * 100).toFixed(1) : '0.0',
    diasHastaCierre, pptoDia, cierreFecha: cierreStr,
  };
}

// --- Mutaciones ---

export function agregarGasto(g: Partial<Gasto>): { success: true; row: number } {
  const moneda = (g.moneda || 'ARS') as string;
  const stmt = db.prepare(`
    INSERT INTO gastos (fecha, motivo, monto_ars, moneda, monto_ext, imputar, tipo, cuota, categoria, estado, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    g.fecha || '',
    g.motivo || '',
    moneda === 'ARS' ? num(g.montoARS) : 0,
    moneda,
    moneda !== 'ARS' ? num(g.montoExt ?? g.montoUSD) : 0,
    g.imputar || '',
    g.tipo || 'Variable',
    g.cuota || '',
    g.categoria || 'Otros',
    g.estado || 'Pagado',
    g.notas || ''
  );
  return { success: true, row: Number(info.lastInsertRowid) };
}

export function editarGasto(g: Partial<Gasto> & { row: number }): { success: true } {
  const moneda = (g.moneda || 'ARS') as string;
  db.prepare(`
    UPDATE gastos SET fecha=?, motivo=?, monto_ars=?, moneda=?, monto_ext=?, imputar=?, tipo=?, cuota=?, categoria=?, estado=?, notas=?
    WHERE id = ?
  `).run(
    g.fecha || '',
    g.motivo || '',
    moneda === 'ARS' ? num(g.montoARS) : 0,
    moneda,
    moneda !== 'ARS' ? num(g.montoExt ?? g.montoUSD) : 0,
    g.imputar || '',
    g.tipo || 'Variable',
    g.cuota || '',
    g.categoria || 'Otros',
    g.estado || 'Pagado',
    g.notas || '',
    g.row
  );
  return { success: true };
}

export function eliminarGasto(row: number): { success: true } {
  db.prepare(`DELETE FROM gastos WHERE id = ?`).run(row);
  return { success: true };
}

export function eliminarGastosBulk(rows: number[]): { success: true } {
  const stmt = db.prepare(`DELETE FROM gastos WHERE id = ?`);
  withTransaction(() => { for (const id of rows) stmt.run(id); });
  return { success: true };
}

export function toggleEstado(row: number, nuevoEstado: string): { success: true } {
  db.prepare(`UPDATE gastos SET estado = ? WHERE id = ?`).run(nuevoEstado, row);
  return { success: true };
}

export function editarIngreso(row: number | string, monto: number): { success: true } {
  if (row === 'USD') {
    setSettingValue('tenencia_usd', String(num(monto)));
  } else {
    // mapeo de filas legacy: 6 → Sueldo (id=1), 7 → MP (id=2), 8 → NUBI (id=3)
    let id = Number(row);
    if (id === 6) id = 1;
    else if (id === 7) id = 2;
    else if (id === 8) id = 3;
    db.prepare(`UPDATE ingresos SET monto = ? WHERE id = ?`).run(num(monto), id);
  }
  return { success: true };
}

export function editarTC(nuevoTC: number): { success: true } {
  setSettingValue('tc_usd', String(num(nuevoTC)));
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  setSettingValue('tc_fecha', `${dd}/${mm}/${d.getFullYear()}`);
  return { success: true };
}

export function editarCierreTarjeta(fecha: string): { success: true } {
  setSettingValue('cierre_tarjeta', fecha);
  return { success: true };
}

export function agregarRendimiento(billetera: string, monto: number): { success: true } {
  if (billetera === 'MP') {
    const cur = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 2`).get() as any)?.monto);
    db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 2`).run(cur + num(monto));
  } else if (billetera === 'NUBI') {
    const cur = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 3`).get() as any)?.monto);
    db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 3`).run(cur + num(monto));
  } else {
    const cur = num(getSetting('tenencia_usd'));
    setSettingValue('tenencia_usd', String(cur + num(monto)));
  }
  return { success: true };
}

export function saveOrigenes(arr: string[]) {
  if (!Array.isArray(arr) || !arr.length) throw new Error('Lista vacía');
  setSettingValue('origenes', JSON.stringify(arr));
  return { success: true };
}

export function saveCategorias(arr: string[]) {
  if (!Array.isArray(arr) || !arr.length) throw new Error('Lista vacía');
  setSettingValue('categorias', JSON.stringify(arr));
  return { success: true };
}

export function savePlantillas(arr: Plantilla[]) {
  if (!Array.isArray(arr)) throw new Error('Inválido');
  setSettingValue('plantillas', JSON.stringify(arr));
  return { success: true };
}

export function previewCierreMes() {
  const tcUSD = num(getSetting('tc_usd')) || 1400;
  const tcEUR = num(getSetting('tc_eur')) || 1500;
  const sueldo = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 1`).get() as any)?.monto);
  const mp = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 2`).get() as any)?.monto);
  const nubi = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 3`).get() as any)?.monto);
  const tenenciaUSD = num(getSetting('tenencia_usd'));
  const rows = db.prepare(`SELECT * FROM gastos`).all() as GastoRow[];
  const data = rows.map(r => rowToGasto(r, tcUSD, tcEUR));

  let totalGastos = 0, gastosNUBI = 0, gastosUSD_USD = 0, gastosOtros = 0;
  let fijosPasan = 0, variablesBorran = 0, cuotasAvanzan = 0, cuotasTerminan = 0;
  for (const g of data) {
    totalGastos += g.arsEquiv;
    if (g.imputar === 'NUBI') gastosNUBI += g.arsEquiv;
    else if (g.imputar === 'Caja USD') gastosUSD_USD += (g.moneda === 'USD' ? g.montoExt : g.arsEquiv / (tcUSD || 1));
    else gastosOtros += g.arsEquiv;
    if (g.tipo === 'Fijo') fijosPasan++;
    else variablesBorran++;
    if (g.cuota && g.cuota.includes('/')) {
      const p = g.cuota.split('/');
      const ca = parseInt(p[0]!) || 0, ct = parseInt(p[1]!) || 0;
      if (ca < ct) cuotasAvanzan++; else cuotasTerminan++;
    }
  }

  return {
    totalGastos: Math.round(totalGastos),
    sobranteNUBI: Math.round(nubi - gastosNUBI),
    sobranteMP: Math.round((sueldo + mp) - gastosOtros),
    sobranteUSD: Math.round((tenenciaUSD - gastosUSD_USD) * 100) / 100,
    fijosPasan,
    variablesBorran,
    cuotasAvanzan,
    cuotasTerminan,
    gastosCount: data.length,
  };
}

// --- Cierre de mes ---

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const TITULO_PREFIJO = '💰 FINANZAS PERSONALES — ';
export function cerrarMes(nuevoMes: string, nuevoAnio: string | number, nuevaFechaCierre: string) {
  if (!MESES.includes(nuevoMes)) throw new Error('Mes inválido');

  const tcUSD = num(getSetting('tc_usd')) || 1400;
  const tcEUR = num(getSetting('tc_eur')) || 1500;
  const tituloActual = getSetting('titulo') || '';
  // Poka-yoke: el 31/07/2026 se cerro "Julio 2026" eligiendo "Julio" otra vez como mes
  // nuevo. El rotulo quedo clavado y agosto se cargo dentro de un mes llamado julio.
  const mesActual = tituloActual.replace(TITULO_PREFIJO, '').trim();
  if (mesActual && mesActual.toLowerCase() === `${nuevoMes} ${nuevoAnio}`.trim().toLowerCase()) {
    throw new Error(`El mes nuevo no puede ser el mismo que el actual (${mesActual}). Elegí el mes siguiente.`);
  }

  const sueldo = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 1`).get() as any)?.monto);
  const mp = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 2`).get() as any)?.monto);
  const nubi = num((db.prepare(`SELECT monto FROM ingresos WHERE id = 3`).get() as any)?.monto);
  const tenenciaUSD = num(getSetting('tenencia_usd'));
  const sueldoMP = sueldo + mp;

  const rows = db.prepare(`SELECT * FROM gastos`).all() as GastoRow[];
  const data = rows.map(r => rowToGasto(r, tcUSD, tcEUR));

  let gastosNoNUBI_NoUSD = 0, gastosNUBI = 0, gastosCajaUSD_USD = 0;
  const allGastos: Array<Omit<GastoRow, 'id'>> = [];
  let varSumARS = 0;

  const monthIdx = MESES.indexOf(nuevoMes);
  const nuevaFecha = `01/${String(monthIdx + 1).padStart(2, '0')}/${nuevoAnio}`;

  for (const g of data) {
    if (g.imputar === 'NUBI') gastosNUBI += g.arsEquiv;
    else if (g.imputar === 'Caja USD') gastosCajaUSD_USD += (g.moneda === 'USD' ? g.montoExt : g.arsEquiv / (tcUSD || 1));
    else gastosNoNUBI_NoUSD += g.arsEquiv;

    if (g.tipo === 'Variable') {
      varSumARS += g.moneda === 'ARS' ? g.montoARS : g.montoExt * (g.moneda === 'USD' ? tcUSD : tcEUR);
    }

    let cuotaNueva = g.cuota;
    if (g.cuota && g.cuota.includes('/')) {
      const p = g.cuota.split('/');
      const ca = parseInt(p[0]!) || 0, ct = parseInt(p[1]!) || 0;
      cuotaNueva = (ca < ct) ? `${ca + 1}/${ct}` : '';
    }

    if (g.tipo === 'Fijo') {
      // los fijos pasan al nuevo mes
      allGastos.push({
        fecha: nuevaFecha,
        motivo: g.motivo,
        monto_ars: g.montoARS,
        moneda: g.moneda,
        monto_ext: g.montoExt,
        imputar: g.imputar,
        tipo: g.tipo,
        cuota: cuotaNueva,
        categoria: g.categoria,
        estado: 'Pendiente',
        notas: g.notas,
      });
    }
  }

  const sobranteNUBI = Math.round(nubi - gastosNUBI);
  const sobranteMP = Math.round(sueldoMP - gastosNoNUBI_NoUSD);
  const sobranteUSD = tenenciaUSD - gastosCajaUSD_USD;
  const totalIngresos = sueldo + mp + nubi + (tenenciaUSD * tcUSD);
  const totalGastos = gastosNoNUBI_NoUSD + gastosNUBI + (gastosCajaUSD_USD * tcUSD);
  const pctVar = totalGastos > 0 ? Number((varSumARS / totalGastos * 100).toFixed(1)) : 0;

  withTransaction(() => {
    db.prepare(`INSERT INTO historico (mes, ingresos, gastos, margen, pct_variable, sobrante_nubi, sobrante_mp) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        tituloActual.replace(TITULO_PREFIJO, ''),
        totalIngresos,
        totalGastos,
        totalIngresos - totalGastos,
        pctVar,
        sobranteNUBI,
        sobranteMP
      );

    // Borramos SOLO los ids que acabamos de contabilizar, no "todo". El wipe global
    // funcionaba, pero borraba a ciegas: un gasto cargado entre la lectura de arriba y
    // este punto se iba sin haber sido contabilizado en el histórico. Borrar por id no
    // puede llevarse lo que no contó. Mismo criterio en worker.js (el que corre en prod).
    const idsContabilizados = rows.map(r => r.id).filter(id => id != null);
    for (let i = 0; i < idsContabilizados.length; i += 90) {
      const chunk = idsContabilizados.slice(i, i + 90);
      db.prepare(`DELETE FROM gastos WHERE id IN (${chunk.map(() => '?').join(',')})`).run(...chunk);
    }
    const ins = db.prepare(`
      INSERT INTO gastos (fecha, motivo, monto_ars, moneda, monto_ext, imputar, tipo, cuota, categoria, estado, notas)
      VALUES (@fecha, @motivo, @monto_ars, @moneda, @monto_ext, @imputar, @tipo, @cuota, @categoria, @estado, @notas)
    `);
    for (const g of allGastos) ins.run(g);

    db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 2`).run(Math.round(mp + sobranteMP));
    db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 3`).run(Math.round(nubi + sobranteNUBI));
    setSettingValue('tenencia_usd', String(Math.round(sobranteUSD * 100) / 100));
    setSettingValue('titulo', `${TITULO_PREFIJO}${nuevoMes} ${nuevoAnio}`);
    if (nuevaFechaCierre) setSettingValue('cierre_tarjeta', nuevaFechaCierre);
  });

  return {
    success: true,
    sobranteMP,
    sobranteNUBI,
    sobranteUSD: Math.round(sobranteUSD * 100) / 100,
  };
}
