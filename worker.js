// ============================================================================
// ESTE ARCHIVO ES EL FUENTE DE PRODUCCION. Editalo a mano.
//
// wrangler.toml apunta a main = "worker.js": Cloudflare sirve ESTE archivo.
//
// Es un bundle de esbuild de una version async/D1 cuyos fuentes NO estan en el
// repo (fijate en la marca "// src/worker.ts" mas abajo: ese archivo no existe ni
// figura en el historial de git). Los src/*.ts que si estan son la version
// SINCRONA de Express + node:sqlite del deploy viejo de Railway, que esta muerto.
//
// NO regeneres este archivo con esbuild desde src/: produciria codigo sincrono de
// node:sqlite corriendo en Workers y la app se cae entera.
//
// Si cambias logica compartida, aplicala en los dos lados y corre `npm run
// check:worker`, que avisa cuando se toco src/ sin tocar este archivo.
// ============================================================================
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// Zona horaria del usuario. El Worker corre en UTC, asi que cualquier cuenta de dias
// calendario tiene que resolverse contra esta zona y no contra la del runtime.
var TZ_USUARIO = "America/Argentina/Buenos_Aires";

// src/auth.ts
var COOKIE = "fin_auth";
var MAX_AGE = 60 * 60 * 24 * 30;
function isAuthEnabled(env) {
  return !!(env.APP_PASSWORD && env.APP_PASSWORD.length > 0);
}
__name(isAuthEnabled, "isAuthEnabled");
function getSecret(env) {
  return env.SESSION_SECRET || (env.APP_PASSWORD ? `dev-secret-${env.APP_PASSWORD}` : "");
}
__name(getSecret, "getSecret");
async function hmacSign(value, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacSign, "hmacSign");
function timingSafeEqual(a, b) {
  if (a.length !== b.length)
    return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++)
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
async function makeToken(secret) {
  const issued = Date.now().toString();
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const payload = `${issued}.${nonce}`;
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}
__name(makeToken, "makeToken");
async function isValidToken(raw, secret) {
  if (!raw)
    return false;
  const parts = raw.split(".");
  if (parts.length !== 3)
    return false;
  const [issued, nonce, given] = parts;
  const expected = await hmacSign(`${issued}.${nonce}`, secret);
  if (!timingSafeEqual(given, expected))
    return false;
  const issuedMs = Number(issued);
  if (!issuedMs || Date.now() - issuedMs > MAX_AGE * 1e3)
    return false;
  return true;
}
__name(isValidToken, "isValidToken");
function parseCookies(header) {
  const out = {};
  if (!header)
    return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k)
      out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}
__name(parseCookies, "parseCookies");
async function isAuthed(req, env) {
  if (!isAuthEnabled(env))
    return true;
  const cookies = parseCookies(req.headers.get("cookie"));
  return await isValidToken(cookies[COOKIE], getSecret(env));
}
__name(isAuthed, "isAuthed");
async function loginHandler(req, env) {
  let body = {};
  try {
    body = await req.json();
  } catch {
  }
  const pwd = String(body.password ?? "");
  if (!isAuthEnabled(env)) {
    return Response.json({ ok: true });
  }
  const PASSWORD = env.APP_PASSWORD;
  if (pwd.length !== PASSWORD.length || !timingSafeEqual(pwd, PASSWORD)) {
    return new Response(JSON.stringify({ error: "Contrase\xF1a incorrecta" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  const token = await makeToken(getSecret(env));
  const url = new URL(req.url);
  const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const cookie = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? "; Secure" : ""}`;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie }
  });
}
__name(loginHandler, "loginHandler");
function logoutHandler() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`
    }
  });
}
__name(logoutHandler, "logoutHandler");

// src/db.ts
async function getSetting(db, key) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row?.value ?? "";
}
__name(getSetting, "getSetting");
async function setSettingValue(db, key, value) {
  await db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}
__name(setSettingValue, "setSettingValue");

// src/services/finanzas.ts
var num = /* @__PURE__ */ __name((v) => {
  if (v == null || v === "")
    return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}, "num");
var arsEquivOf = /* @__PURE__ */ __name((g, tcUSD, tcEUR) => {
  if (g.moneda === "USD")
    return num(g.monto_ext) * tcUSD;
  if (g.moneda === "EUR")
    return num(g.monto_ext) * tcEUR;
  return num(g.monto_ars);
}, "arsEquivOf");
var rowToGasto = /* @__PURE__ */ __name((r, tcUSD, tcEUR) => ({
  row: r.id,
  fecha: r.fecha,
  motivo: r.motivo,
  montoARS: num(r.monto_ars),
  moneda: r.moneda || "ARS",
  montoExt: num(r.monto_ext),
  montoUSD: r.moneda === "USD" ? num(r.monto_ext) : 0,
  imputar: r.imputar || "",
  tipo: r.tipo || "Variable",
  cuota: r.cuota || "",
  arsEquiv: arsEquivOf(r, tcUSD, tcEUR),
  categoria: r.categoria || "Otros",
  estado: r.estado || "Pagado",
  notas: r.notas || ""
}), "rowToGasto");
async function getAllData(db) {
  const [
    settingsArr,
    ingresosRes,
    gastosRes,
    histRes
  ] = await Promise.all([
    db.prepare(`SELECT key, value FROM settings`).all(),
    db.prepare(`SELECT id, concepto, monto FROM ingresos ORDER BY id`).all(),
    db.prepare(`SELECT * FROM gastos ORDER BY id`).all(),
    db.prepare(`SELECT mes, ingresos, gastos, margen, pct_variable, sobrante_nubi, sobrante_mp FROM historico ORDER BY id`).all()
  ]);
  const settings = {};
  for (const row of settingsArr.results ?? [])
    settings[row.key] = row.value;
  const tcUSD = num(settings["tc_usd"]) || 1400;
  const tcEUR = num(settings["tc_eur"]) || 1500;
  const tcFecha = settings["tc_fecha"] ?? "";
  const cierreTarjeta = settings["cierre_tarjeta"] ?? "";
  const tenenciaUSD = num(settings["tenencia_usd"]);
  const titulo = settings["titulo"] || "Finanzas";
  const ingresos = (ingresosRes.results ?? []).map((r) => ({ row: r.id, concepto: r.concepto, monto: num(r.monto) }));
  const gastos = (gastosRes.results ?? []).map((r) => rowToGasto(r, tcUSD, tcEUR));
  const historico = (histRes.results ?? []).map((r) => ({
    mes: r.mes,
    ingresos: num(r.ingresos),
    gastos: num(r.gastos),
    margen: num(r.margen),
    pctVariable: num(r.pct_variable),
    sobranteNUBI: num(r.sobrante_nubi),
    sobranteMP: num(r.sobrante_mp)
  }));
  const dashboard = computeDashboard(gastos, ingresos, tenenciaUSD, tcUSD, cierreTarjeta, historico);
  const origenes = JSON.parse(settings["origenes"] || "[]");
  const categorias = JSON.parse(settings["categorias"] || "[]");
  const plantillas = JSON.parse(settings["plantillas"] || "[]");
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
    tipos: ["Fijo", "Variable"],
    dashboard,
    historico,
    plantillas
  };
}
__name(getAllData, "getAllData");
function computeDashboard(gastos, ingresos, tenenciaUSD, tcUSD, cierreStr, historico) {
  const sueldo = ingresos[0]?.monto ?? 0;
  const mp = ingresos[1]?.monto ?? 0;
  const nubi = ingresos[2]?.monto ?? 0;
  const sueldoMP = sueldo + mp;
  const totalIngresos = sueldo + mp + nubi + tenenciaUSD * tcUSD;
  let tarjOblig = 0, gMP = 0, gNUBI = 0, gUSD_USD = 0, total = 0, fijos = 0, variables = 0;
  for (const g of gastos) {
    const v = g.arsEquiv;
    total += v;
    if (g.imputar === "VISA 5278" || g.imputar === "VISA 4305" || g.imputar === "Obligaci\xF3n Fija")
      tarjOblig += v;
    if (g.imputar === "MP")
      gMP += v;
    if (g.imputar === "NUBI")
      gNUBI += v;
    if (g.imputar === "Caja USD")
      gUSD_USD += g.moneda === "USD" ? g.montoExt : v / (tcUSD || 1);
    if (g.tipo === "Fijo")
      fijos += v;
    if (g.tipo === "Variable")
      variables += v;
  }
  const margen = totalIngresos - total;
  let diasHastaCierre = 0, pptoDia = 0;
  if (cierreStr && cierreStr.includes("/")) {
    const p = cierreStr.split("/");
    if (p.length === 3) {
      // Dos cosas que antes estaban mal en esta cuenta:
      // 1) HOY CUENTA. Si el cierre es manana, quedan hoy y manana = 2 dias. Antes se
      //    hacia cierre - hoy, que daba 1 y por lo tanto DUPLICABA el ppto diario.
      // 2) El Worker corre en UTC. Con new Date() pelado, a partir de las 21:00 de
      //    Argentina ya era "manana" alla y la cuenta se corria un dia mas.
      const hoyAR = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ_USUARIO,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(/* @__PURE__ */ new Date()).split("-").map(Number);
      const hoyUTC = Date.UTC(hoyAR[0], hoyAR[1] - 1, hoyAR[2]);
      const cierreUTC = Date.UTC(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
      diasHastaCierre = Math.max(Math.round((cierreUTC - hoyUTC) / 864e5) + 1, 1);
      pptoDia = Math.round(margen / diasHastaCierre);
    }
  }
  const gastosMesAnterior = historico.length ? num(historico[historico.length - 1].gastos) : 0;
  return {
    sueldoMP,
    gastosTarjOblig: Math.round(tarjOblig),
    disponibleTarjeta: Math.round(sueldoMP - tarjOblig),
    tenenciaMP: mp,
    gastosMP: Math.round(gMP),
    saldoMP: Math.round(mp - gMP),
    ingresoNUBI: nubi,
    gastosNUBI: Math.round(gNUBI),
    saldoNUBI: Math.round(nubi - gNUBI),
    tenenciaUSD,
    gastosCajaUSD_USD: gUSD_USD,
    saldoUSD: tenenciaUSD - gUSD_USD,
    totalIngresos,
    totalGastos: Math.round(total),
    gastosMesAnterior,
    margen: Math.round(margen),
    pctMargen: totalIngresos > 0 ? (margen / totalIngresos * 100).toFixed(1) : "0.0",
    gastosFijos: Math.round(fijos),
    gastosVariables: Math.round(variables),
    pctVariable: total > 0 ? (variables / total * 100).toFixed(1) : "0.0",
    diasHastaCierre,
    pptoDia,
    cierreFecha: cierreStr
  };
}
__name(computeDashboard, "computeDashboard");
async function agregarGasto(db, g) {
  const moneda = g.moneda || "ARS";
  const result = await db.prepare(`
    INSERT INTO gastos (fecha, motivo, monto_ars, moneda, monto_ext, imputar, tipo, cuota, categoria, estado, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    g.fecha || "",
    g.motivo || "",
    moneda === "ARS" ? num(g.montoARS) : 0,
    moneda,
    moneda !== "ARS" ? num(g.montoExt ?? g.montoUSD) : 0,
    g.imputar || "",
    g.tipo || "Variable",
    g.cuota || "",
    g.categoria || "Otros",
    g.estado || "Pagado",
    g.notas || ""
  ).run();
  return { success: true, row: Number(result.meta.last_row_id) };
}
__name(agregarGasto, "agregarGasto");
async function editarGasto(db, g) {
  const moneda = g.moneda || "ARS";
  await db.prepare(`
    UPDATE gastos SET fecha=?, motivo=?, monto_ars=?, moneda=?, monto_ext=?, imputar=?, tipo=?, cuota=?, categoria=?, estado=?, notas=?
    WHERE id = ?
  `).bind(
    g.fecha || "",
    g.motivo || "",
    moneda === "ARS" ? num(g.montoARS) : 0,
    moneda,
    moneda !== "ARS" ? num(g.montoExt ?? g.montoUSD) : 0,
    g.imputar || "",
    g.tipo || "Variable",
    g.cuota || "",
    g.categoria || "Otros",
    g.estado || "Pagado",
    g.notas || "",
    g.row
  ).run();
  return { success: true };
}
__name(editarGasto, "editarGasto");
async function eliminarGasto(db, row) {
  await db.prepare(`DELETE FROM gastos WHERE id = ?`).bind(row).run();
  return { success: true };
}
__name(eliminarGasto, "eliminarGasto");
async function eliminarGastosBulk(db, rows) {
  if (rows.length === 0)
    return { success: true };
  const stmt = db.prepare(`DELETE FROM gastos WHERE id = ?`);
  await db.batch(rows.map((id) => stmt.bind(id)));
  return { success: true };
}
__name(eliminarGastosBulk, "eliminarGastosBulk");
async function toggleEstado(db, row, nuevoEstado) {
  await db.prepare(`UPDATE gastos SET estado = ? WHERE id = ?`).bind(nuevoEstado, row).run();
  return { success: true };
}
__name(toggleEstado, "toggleEstado");
async function editarIngreso(db, row, monto) {
  if (row === "USD") {
    await setSettingValue(db, "tenencia_usd", String(num(monto)));
  } else {
    let id = Number(row);
    if (id === 6)
      id = 1;
    else if (id === 7)
      id = 2;
    else if (id === 8)
      id = 3;
    await db.prepare(`UPDATE ingresos SET monto = ? WHERE id = ?`).bind(num(monto), id).run();
  }
  return { success: true };
}
__name(editarIngreso, "editarIngreso");
async function editarTC(db, nuevoTC) {
  await setSettingValue(db, "tc_usd", String(num(nuevoTC)));
  const d = /* @__PURE__ */ new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  await setSettingValue(db, "tc_fecha", `${dd}/${mm}/${d.getFullYear()}`);
  return { success: true };
}
__name(editarTC, "editarTC");
async function editarCierreTarjeta(db, fecha) {
  await setSettingValue(db, "cierre_tarjeta", fecha);
  return { success: true };
}
__name(editarCierreTarjeta, "editarCierreTarjeta");
async function agregarRendimiento(db, billetera, monto) {
  const m = num(monto);
  if (billetera === "MP") {
    const cur = num((await db.prepare(`SELECT monto FROM ingresos WHERE id = 2`).first())?.monto);
    await db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 2`).bind(cur + m).run();
  } else if (billetera === "NUBI") {
    const cur = num((await db.prepare(`SELECT monto FROM ingresos WHERE id = 3`).first())?.monto);
    await db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 3`).bind(cur + m).run();
  } else {
    const cur = num(await getSetting(db, "tenencia_usd"));
    await setSettingValue(db, "tenencia_usd", String(cur + m));
  }
  return { success: true };
}
__name(agregarRendimiento, "agregarRendimiento");
async function saveOrigenes(db, arr) {
  if (!Array.isArray(arr) || !arr.length)
    throw new Error("Lista vac\xEDa");
  await setSettingValue(db, "origenes", JSON.stringify(arr));
  return { success: true };
}
__name(saveOrigenes, "saveOrigenes");
async function saveCategorias(db, arr) {
  if (!Array.isArray(arr) || !arr.length)
    throw new Error("Lista vac\xEDa");
  await setSettingValue(db, "categorias", JSON.stringify(arr));
  return { success: true };
}
__name(saveCategorias, "saveCategorias");
async function savePlantillas(db, arr) {
  if (!Array.isArray(arr))
    throw new Error("Inv\xE1lido");
  await setSettingValue(db, "plantillas", JSON.stringify(arr));
  return { success: true };
}
__name(savePlantillas, "savePlantillas");
var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
async function loadCierreState(db) {
  const [settingsArr, ingresosArr, gastosArr] = await Promise.all([
    db.prepare(`SELECT key, value FROM settings`).all(),
    db.prepare(`SELECT id, monto FROM ingresos`).all(),
    db.prepare(`SELECT * FROM gastos`).all()
  ]);
  const settings = {};
  for (const r of settingsArr.results ?? [])
    settings[r.key] = r.value;
  const ingresos = {};
  for (const r of ingresosArr.results ?? [])
    ingresos[r.id] = num(r.monto);
  return { settings, ingresos, gastos: gastosArr.results ?? [] };
}
__name(loadCierreState, "loadCierreState");
async function previewCierreMes(db) {
  const { settings, ingresos, gastos: rows } = await loadCierreState(db);
  const tcUSD = num(settings["tc_usd"]) || 1400;
  const tcEUR = num(settings["tc_eur"]) || 1500;
  const sueldo = num(ingresos[1]);
  const mp = num(ingresos[2]);
  const nubi = num(ingresos[3]);
  const tenenciaUSD = num(settings["tenencia_usd"]);
  const data = rows.map((r) => rowToGasto(r, tcUSD, tcEUR));
  let totalGastos = 0, gastosNUBI = 0, gastosUSD_USD = 0, gastosOtros = 0;
  let fijosPasan = 0, variablesBorran = 0, cuotasAvanzan = 0, cuotasTerminan = 0;
  for (const g of data) {
    totalGastos += g.arsEquiv;
    if (g.imputar === "NUBI")
      gastosNUBI += g.arsEquiv;
    else if (g.imputar === "Caja USD")
      gastosUSD_USD += g.moneda === "USD" ? g.montoExt : g.arsEquiv / (tcUSD || 1);
    else
      gastosOtros += g.arsEquiv;
    if (g.tipo === "Fijo")
      fijosPasan++;
    else
      variablesBorran++;
    if (g.cuota && g.cuota.includes("/")) {
      const p = g.cuota.split("/");
      const ca = parseInt(p[0]) || 0, ct = parseInt(p[1]) || 0;
      if (ca < ct)
        cuotasAvanzan++;
      else
        cuotasTerminan++;
    }
  }
  return {
    totalGastos: Math.round(totalGastos),
    sobranteNUBI: Math.round(nubi - gastosNUBI),
    sobranteMP: Math.round(sueldo + mp - gastosOtros),
    sobranteUSD: Math.round((tenenciaUSD - gastosUSD_USD) * 100) / 100,
    fijosPasan,
    variablesBorran,
    cuotasAvanzan,
    cuotasTerminan,
    gastosCount: data.length
  };
}
__name(previewCierreMes, "previewCierreMes");
var TITULO_PREFIJO = "\u{1F4B0} FINANZAS PERSONALES \u2014 ";
async function cerrarMes(db, nuevoMes, nuevoAnio, nuevaFechaCierre) {
  if (!MESES.includes(nuevoMes))
    throw new Error("Mes inv\xE1lido");
  const { settings, ingresos, gastos: rows } = await loadCierreState(db);
  const tcUSD = num(settings["tc_usd"]) || 1400;
  const tcEUR = num(settings["tc_eur"]) || 1500;
  const tituloActual = settings["titulo"] || "";
  // Poka-yoke: el 31/07/2026 se cerro "Julio 2026" eligiendo "Julio" otra vez como
  // mes nuevo. El rotulo quedo clavado y agosto se cargo dentro de un mes llamado
  // julio. Un error de dedo no puede volver a desordenar meses de datos.
  const mesActual = tituloActual.replace(TITULO_PREFIJO, "").trim();
  if (mesActual && mesActual.toLowerCase() === `${nuevoMes} ${nuevoAnio}`.trim().toLowerCase()) {
    throw new Error(`El mes nuevo no puede ser el mismo que el actual (${mesActual}). Elegi el mes siguiente.`);
  }
  const sueldo = num(ingresos[1]);
  const mp = num(ingresos[2]);
  const nubi = num(ingresos[3]);
  const tenenciaUSD = num(settings["tenencia_usd"]);
  const sueldoMP = sueldo + mp;
  const data = rows.map((r) => rowToGasto(r, tcUSD, tcEUR));
  let gastosNoNUBI_NoUSD = 0, gastosNUBI = 0, gastosCajaUSD_USD = 0;
  let varSumARS = 0;
  const allGastos = [];
  const monthIdx = MESES.indexOf(nuevoMes);
  const nuevaFecha = `01/${String(monthIdx + 1).padStart(2, "0")}/${nuevoAnio}`;
  for (const g of data) {
    if (g.imputar === "NUBI")
      gastosNUBI += g.arsEquiv;
    else if (g.imputar === "Caja USD")
      gastosCajaUSD_USD += g.moneda === "USD" ? g.montoExt : g.arsEquiv / (tcUSD || 1);
    else
      gastosNoNUBI_NoUSD += g.arsEquiv;
    if (g.tipo === "Variable") {
      varSumARS += g.moneda === "ARS" ? g.montoARS : g.montoExt * (g.moneda === "USD" ? tcUSD : tcEUR);
    }
    let cuotaNueva = g.cuota;
    if (g.cuota && g.cuota.includes("/")) {
      const p = g.cuota.split("/");
      const ca = parseInt(p[0]) || 0, ct = parseInt(p[1]) || 0;
      cuotaNueva = ca < ct ? `${ca + 1}/${ct}` : "";
    }
    if (g.tipo === "Fijo") {
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
        estado: "Pendiente",
        notas: g.notas
      });
    }
  }
  const sobranteNUBI = Math.round(nubi - gastosNUBI);
  const sobranteMP = Math.round(sueldoMP - gastosNoNUBI_NoUSD);
  const sobranteUSD = tenenciaUSD - gastosCajaUSD_USD;
  const totalIngresos = sueldo + mp + nubi + tenenciaUSD * tcUSD;
  const totalGastos = gastosNoNUBI_NoUSD + gastosNUBI + gastosCajaUSD_USD * tcUSD;
  const pctVar = totalGastos > 0 ? Number((varSumARS / totalGastos * 100).toFixed(1)) : 0;
  const insertHist = db.prepare(`
    INSERT INTO historico (mes, ingresos, gastos, margen, pct_variable, sobrante_nubi, sobrante_mp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tituloActual.replace(TITULO_PREFIJO, ""),
    totalIngresos,
    totalGastos,
    totalIngresos - totalGastos,
    pctVar,
    sobranteNUBI,
    sobranteMP
  );
  // Borramos SOLO los ids que acabamos de contabilizar en el historico, no "todo",
  // y en su propia operacion verificada. El wipe global funcionaba (verificado en la
  // base real: el cierre de junio limpio bien), pero borraba a ciegas: cualquier gasto
  // cargado entre la lectura de arriba y este punto se iba sin haber sido contabilizado.
  // Borrar por id no puede llevarse lo que no conto.
  const idsContabilizados = rows.map((r) => r.id).filter((id) => id != null);
  const insertGastoStmt = db.prepare(`
    INSERT INTO gastos (fecha, motivo, monto_ars, moneda, monto_ext, imputar, tipo, cuota, categoria, estado, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGastos = allGastos.map((g) => insertGastoStmt.bind(
    g.fecha,
    g.motivo,
    g.monto_ars,
    g.moneda,
    g.monto_ext,
    g.imputar,
    g.tipo,
    g.cuota,
    g.categoria,
    g.estado,
    g.notas
  ));
  const updMP = db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 2`).bind(Math.round(mp + sobranteMP));
  const updNUBI = db.prepare(`UPDATE ingresos SET monto = ? WHERE id = 3`).bind(Math.round(nubi + sobranteNUBI));
  const upsertSetting = /* @__PURE__ */ __name((key, value) => db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, value), "upsertSetting");
  const settingStmts = [
    upsertSetting("tenencia_usd", String(Math.round(sobranteUSD * 100) / 100)),
    upsertSetting("titulo", `${TITULO_PREFIJO}${nuevoMes} ${nuevoAnio}`)
  ];
  if (nuevaFechaCierre)
    settingStmts.push(upsertSetting("cierre_tarjeta", nuevaFechaCierre));
  // El orden importa. Primero insertamos los fijos del mes nuevo: llevan ids nuevos,
  // que no estan en idsContabilizados y por lo tanto sobreviven al DELETE de abajo.
  // Despues borramos lo viejo. El historico se escribe AL FINAL, para que ningun
  // fallo intermedio pueda dejar gastos borrados sin su respaldo en historico.
  if (insertGastos.length) await db.batch(insertGastos);

  let borrados = 0;
  for (let i = 0; i < idsContabilizados.length; i += 90) {
    const chunk = idsContabilizados.slice(i, i + 90);
    const res = await db.prepare(
      `DELETE FROM gastos WHERE id IN (${chunk.map(() => "?").join(",")})`
    ).bind(...chunk).run();
    borrados += res.meta?.changes ?? 0;
  }
  if (borrados !== idsContabilizados.length) {
    // Abortamos ANTES de escribir el historico. Puede quedar una tanda de fijos
    // duplicada, que es molesto pero reversible; perder gastos no lo seria.
    throw new Error(
      `Cierre abortado: se esperaba borrar ${idsContabilizados.length} gastos y se borraron ${borrados}. No se escribio el historico, se puede reintentar.`
    );
  }

  await db.batch([insertHist, updMP, updNUBI, ...settingStmts]);
  return {
    success: true,
    sobranteMP,
    sobranteNUBI,
    sobranteUSD: Math.round(sobranteUSD * 100) / 100
  };
}
__name(cerrarMes, "cerrarMes");

// src/worker.ts
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }), "json");
var err = /* @__PURE__ */ __name((msg, status = 400) => json({ error: msg }, status), "err");
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
__name(readJson, "readJson");
var PUBLIC_PATHS = /* @__PURE__ */ new Set([
  "/login",
  "/login.html",
  "/api/login",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico"
]);
// ============================================================================
// IMPORTADOR DE RESUMEN DE TARJETA (.xlsx)
//
// Un .xlsx es un ZIP con XML adentro. Se descomprime con DecompressionStream, que
// existe en Workers: cero dependencias externas.
//
// Validado contra el resumen real de Visa 5278 (27/08/2026): la suma de lo extraido
// da 1.286.336,11 ARS y 60,94 USD, exactamente los subtotales que declara el banco.
// El unico consumo que no entra en esa suma es el marcado "- Pendiente", que el banco
// tampoco cuenta.
// ============================================================================

var SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;
var u16 = /* @__PURE__ */ __name((d, o) => d.getUint16(o, true), "u16");
var u32 = /* @__PURE__ */ __name((d, o) => d.getUint32(o, true), "u32");

async function zipLeer(buf) {
  const d = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65558); i--) {
    if (u32(d, i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("El archivo no parece un Excel valido (.xlsx).");
  const cantidad = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const entradas = {};
  for (let i = 0; i < cantidad; i++) {
    if (u32(d, p) !== SIG_CEN) break;
    const metodo = u16(d, p + 10), tamComp = u32(d, p + 20);
    const nLen = u16(d, p + 28), eLen = u16(d, p + 30), cLen = u16(d, p + 32);
    const nombre = new TextDecoder().decode(new Uint8Array(buf, p + 46, nLen));
    entradas[nombre] = { offset: u32(d, p + 42), metodo, tamComp };
    p += 46 + nLen + eLen + cLen;
  }
  return entradas;
}
__name(zipLeer, "zipLeer");

async function zipExtraer(buf, e) {
  const d = new DataView(buf);
  let p = e.offset;
  if (u32(d, p) !== SIG_LOC) throw new Error("Archivo Excel corrupto.");
  p += 30 + u16(d, p + 26) + u16(d, p + 28);
  const crudo = new Uint8Array(buf, p, e.tamComp);
  if (e.metodo === 0) return new TextDecoder().decode(crudo);
  if (e.metodo !== 8) throw new Error("Compresion no soportada en el Excel.");
  const stream = new Blob([crudo]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}
__name(zipExtraer, "zipExtraer");

var XML_ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function xmlDesescapar(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);/g, (m, e) => {
    if (XML_ENT[e] !== void 0) return XML_ENT[e];
    return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}
__name(xmlDesescapar, "xmlDesescapar");

function textoDeT(frag) {
  return (frag.match(/<t[^>]*>[\s\S]*?<\/t>/g) || [])
    .map((t) => xmlDesescapar(t.replace(/^<t[^>]*>/, "").replace(/<\/t>$/, ""))).join("");
}
__name(textoDeT, "textoDeT");

function colIndice(ref) {
  const letras = (ref.match(/^[A-Z]+/) || ["A"])[0];
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}
__name(colIndice, "colIndice");

async function leerXlsx(arrayBuffer) {
  const zip = await zipLeer(arrayBuffer);
  const shared = [];
  if (zip["xl/sharedStrings.xml"]) {
    const xml = await zipExtraer(arrayBuffer, zip["xl/sharedStrings.xml"]);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(textoDeT(si));
  }
  const hoja = Object.keys(zip).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0])[0];
  if (!hoja) throw new Error("El Excel no tiene ninguna hoja.");
  const xml = await zipExtraer(arrayBuffer, zip[hoja]);
  const filas = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const celdas = [];
    for (const c of rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []) {
      const ref = (c.match(/r="([A-Z]+\d+)"/) || [])[1];
      const tipo = (c.match(/t="([^"]+)"/) || [])[1];
      let val = "";
      if (tipo === "inlineStr") val = textoDeT((c.match(/<is>[\s\S]*?<\/is>/) || [""])[0]);
      else {
        const v = c.match(/<v>([\s\S]*?)<\/v>/);
        if (v) val = tipo === "s" ? shared[+v[1]] ?? "" : xmlDesescapar(v[1]);
      }
      const idx = ref ? colIndice(ref) : celdas.length;
      while (celdas.length < idx) celdas.push("");
      celdas[idx] = val;
    }
    filas.push(celdas);
  }
  return filas;
}
__name(leerXlsx, "leerXlsx");

// ---------- normalizacion de los datos del resumen ----------

function montoResumen(txt) {
  if (txt == null) return 0;
  const s = String(txt).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^\d,.\-]/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
__name(montoResumen, "montoResumen");

function cuotaResumen(txt) {
  const m = String(txt || "").match(/(\d+)\s*de\s*(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : "";
}
__name(cuotaResumen, "cuotaResumen");

// "Merpago*centrodeelearning" -> "Centrodeelearning". El procesador de pago no aporta.
function motivoSugerido(desc) {
  let s = String(desc || "").trim();
  s = s.replace(/^(merpago|mercadopago|dlo|epagos|finpay|pedidosya|payu|mobbex)\s*\*\s*/i, "");
  s = s.replace(/\s*-\s*pendiente?\.?$/i, "");
  s = s.replace(/\s+\d{6,}[\d-]*$/, "");
  s = s.replace(/\s+[a-z0-9]{12,}$/i, "");
  s = s.replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(desc || "").trim();
}
__name(motivoSugerido, "motivoSugerido");

function normTexto(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
__name(normTexto, "normTexto");

// Clave estable para el diccionario de alias: ignora hashes y numeros que cambian
// en cada transaccion, para que "Anthropic in1tz..." y "Anthropic in9xy..." sean lo mismo.
function claveAlias(desc) {
  return normTexto(motivoSugerido(desc));
}
__name(claveAlias, "claveAlias");

var STOP_ALIAS = /* @__PURE__ */ new Set(["de", "la", "el", "los", "las", "del", "y", "sa", "srl", "com", "ar", "www"]);
function tokensDe(s) {
  return new Set(normTexto(s).split(" ").filter((t) => t.length > 2 && !STOP_ALIAS.has(t)));
}
__name(tokensDe, "tokensDe");

function similitudTexto(a, b) {
  const A = tokensDe(a), B = tokensDe(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) { inter++; continue; }
    for (const u of B) if (t.length >= 5 && (u.startsWith(t) || t.startsWith(u))) { inter++; break; }
  }
  return inter / (A.size + B.size - inter);
}
__name(similitudTexto, "similitudTexto");

function diasEntreFechas(a, b) {
  const p = /* @__PURE__ */ __name((s) => {
    const x = String(s || "").split("/");
    const d = Date.UTC(+x[2], +x[1] - 1, +x[0]);
    return isNaN(d) ? null : d;
  }, "p");
  const x = p(a), y = p(b);
  return x === null || y === null ? 9999 : Math.abs(x - y) / 864e5;
}
__name(diasEntreFechas, "diasEntreFechas");

function extraerConsumos(filas) {
  const res = { cierre: "", vencimiento: "", consumos: [], pagos: [], totales: {} };
  for (let i = 0; i < filas.length - 1; i++) {
    if (/fecha de cierre/i.test(filas[i][0] || "")) {
      res.cierre = (filas[i + 1][0] || "").trim();
      res.vencimiento = (filas[i + 1][1] || "").trim();
      break;
    }
  }
  let seccion = "", enTabla = false, ultimaFecha = "";
  for (const f of filas) {
    const c0 = (f[0] || "").trim();
    const esHeader = /^fecha$/i.test(c0) && /^descripci/i.test((f[1] || "").trim());
    if (esHeader) { enTabla = true; ultimaFecha = ""; continue; }
    if (!enTabla) { if (c0) seccion = c0; continue; }
    if (/^subtotal/i.test(c0)) {
      res.totales = { ars: montoResumen(f[4]), usd: montoResumen(f[5]) };
      enTabla = false; seccion = ""; continue;
    }
    const desc = (f[1] || "").trim();
    if (!desc) { if (c0) { enTabla = false; seccion = c0; } continue; }
    if (c0) ultimaFecha = c0;   // la fecha solo figura en el primer consumo de cada dia
    const montoARS = montoResumen(f[4]), montoUSD = montoResumen(f[5]);
    if (!montoARS && !montoUSD) continue;
    const comprobante = (f[3] || "").trim();
    const item = {
      fecha: ultimaFecha, descripcion: desc, motivoSugerido: motivoSugerido(desc),
      cuota: cuotaResumen(f[2]), comprobante, montoARS, montoUSD,
      moneda: montoUSD && !montoARS ? "USD" : "ARS",
      pendiente: /-\s*pendiente?\.?$/i.test(desc) || comprobante === "-",
    };
    const esPago = /pago de tarjeta|devoluci/i.test(seccion) || montoARS < 0 || montoUSD < 0;
    (esPago ? res.pagos : res.consumos).push(item);
  }
  return res;
}
__name(extraerConsumos, "extraerConsumos");

// Cruza cada consumo con los gastos ya cargados.
//  ya_cargado        -> el comprobante figura en las notas de un gasto (certeza total)
//  posible_duplicado -> se parece a uno existente; decide el usuario
//  nuevo             -> no se parece a nada
function marcarExistentes(consumos, gastos) {
  const porComprobante = /* @__PURE__ */ new Map();
  for (const g of gastos) {
    for (const m of String(g.notas || "").matchAll(/\[tarjeta:([^\|\]]+)/g)) porComprobante.set(m[1], g);
  }
  return consumos.map((c) => {
    if (c.comprobante && c.comprobante !== "-") {
      const ya = porComprobante.get(c.comprobante);
      if (ya) return { ...c, estado: "ya_cargado", matchId: ya.row, matchMotivo: ya.motivo, confianza: "exacta" };
    }
    const monto = c.moneda === "USD" ? c.montoUSD : c.montoARS;
    if (!monto) return { ...c, estado: "nuevo", candidatos: 0 };
    const puntuados = [];
    for (const g of gastos) {
      if (String(g.moneda || "ARS") !== c.moneda) continue;
      const gm = c.moneda === "USD" ? num(g.montoExt) : num(g.montoARS);
      if (!gm) continue;
      // Tolerancia ABSOLUTA: quien redondea al cargar redondea a centenas, no un %.
      // Con umbral relativo, Telecentro (108.894) matcheaba con un curso de 106.944.
      const dif = Math.abs(gm - monto);
      const tol = Math.max(c.moneda === "USD" ? 0.5 : 50, monto * 0.002);
      let score = 0;
      if (dif < 0.01) score += 5;
      else if (dif <= tol) score += 2;
      else continue;
      if (c.cuota && String(g.cuota || "") === c.cuota) score += 4;
      const sim = similitudTexto(c.descripcion + " " + c.motivoSugerido, g.motivo);
      if (sim >= 0.5) score += 3; else if (sim > 0) score += 1;
      // La fecha pesa poco: los gastos Fijos llevan 01/MM porque cerrarMes se la reescribe.
      const d = diasEntreFechas(c.fecha, g.fecha);
      if (d <= 5) score += 2; else if (d <= 40) score += 1;
      puntuados.push({ g, score, sim });
    }
    if (!puntuados.length) return { ...c, estado: "nuevo", candidatos: 0 };
    puntuados.sort((a, b) => b.score - a.score || b.sim - a.sim);
    const top = puntuados[0];
    const empatados = puntuados.filter((p) => p.score === top.score).length;
    // "alta" solo si el NOMBRE tambien coincide. Con monto y fecha nada mas, un consumo
    // de Anthropic por U$S5 quedaba "alta" contra un gasto de Cloudflare de U$S5: mismo
    // precio, dias cercanos y cero que ver uno con otro. Sin parecido de nombre, media.
    const confianza = empatados > 1 ? "ambigua" : top.sim > 0 && top.score >= 7 ? "alta" : "media";
    return { ...c, estado: "posible_duplicado", matchId: top.g.row, matchMotivo: top.g.motivo, candidatos: empatados, confianza };
  });
}
__name(marcarExistentes, "marcarExistentes");

// ---------- endpoints ----------

async function parsearResumenTarjeta(db, arrayBuffer) {
  const filas = await leerXlsx(arrayBuffer);
  const r = extraerConsumos(filas);
  if (!r.consumos.length) throw new Error("No encontre consumos en ese Excel. Fijate que sea el de 'Ultimos consumos' del banco.");

  const { settings, gastos } = await loadCierreState(db);
  const alias = JSON.parse(settings["alias_tarjeta"] || "{}");
  const marcados = marcarExistentes(r.consumos, gastos.map((g) => rowToGasto(g, num(settings["tc_usd"]) || 1400, num(settings["tc_eur"]) || 1500)));

  // El alias manda sobre la sugerencia: es el nombre que el usuario ya eligio antes.
  const conAlias = marcados.map((c) => {
    const a = alias[claveAlias(c.descripcion)];
    return a ? { ...c, motivoSugerido: a.motivo || c.motivoSugerido, categoria: a.categoria || "", tipo: a.tipo || "", imputar: a.imputar || "", estadoAlias: a.estado || "Pagado", desdeAlias: true } : c;
  });

  const sumaARS = r.consumos.filter((c) => !c.pendiente).reduce((a, c) => a + c.montoARS, 0);
  const sumaUSD = r.consumos.filter((c) => !c.pendiente).reduce((a, c) => a + c.montoUSD, 0);
  return {
    cierre: r.cierre, vencimiento: r.vencimiento, totales: r.totales,
    // Si esto no cuadra, algo se leyo mal: el front lo muestra como advertencia.
    cuadra: Math.abs(sumaARS - num(r.totales.ars)) < 1 && Math.abs(sumaUSD - num(r.totales.usd)) < 0.01,
    sumaARS, sumaUSD,
    pagos: r.pagos, consumos: conAlias,
  };
}
__name(parsearResumenTarjeta, "parsearResumenTarjeta");

async function importarConsumos(db, items) {
  if (!Array.isArray(items) || !items.length) throw new Error("No hay consumos para importar.");
  const { settings } = await loadCierreState(db);
  const alias = JSON.parse(settings["alias_tarjeta"] || "{}");

  const stmt = db.prepare(`
    INSERT INTO gastos (fecha, motivo, monto_ars, moneda, monto_ext, imputar, tipo, cuota, categoria, estado, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const inserts = [];
  for (const g of items) {
    const moneda = g.moneda === "USD" ? "USD" : "ARS";
    // El comprobante y la descripcion del banco quedan anclados en notas: el comprobante
    // para que una segunda importacion reconozca el gasto, y la descripcion para poder
    // mostrar de donde salio. El front los oculta salvo en el detalle del gasto.
    const ancla = g.comprobante && g.comprobante !== "-"
      ? `[tarjeta:${g.comprobante}|${String(g.descripcion || "").replace(/[\[\]|]/g, " ")}]` : "";
    const notas = [String(g.notas || "").trim(), ancla].filter(Boolean).join(" ");
    inserts.push(stmt.bind(
      g.fecha || "", g.motivo || motivoSugerido(g.descripcion),
      moneda === "ARS" ? num(g.montoARS) : 0, moneda, moneda === "USD" ? num(g.montoUSD) : 0,
      g.imputar || "", g.tipo || "Variable", g.cuota || "", g.categoria || "Otros",
      g.estado || "Pagado", notas));
    // Aprendemos el alias para la proxima importacion.
    if (g.descripcion && g.motivo) {
      // Se recuerda TODO lo que el usuario completo, estado incluido: si un comercio
      // siempre entra como Pendiente, no tiene que volver a marcarlo cada mes.
      alias[claveAlias(g.descripcion)] = { motivo: g.motivo, categoria: g.categoria || "", tipo: g.tipo || "", imputar: g.imputar || "", estado: g.estado || "Pagado" };
    }
  }
  await db.batch(inserts);
  await setSettingValue(db, "alias_tarjeta", JSON.stringify(alias));
  return { success: true, importados: inserts.length };
}
__name(importarConsumos, "importarConsumos");

var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();
    try {
      if (path === "/api/health") {
        return json({ ok: true, authEnabled: isAuthEnabled(env) });
      }
      if (path === "/api/login" && method === "POST")
        return await loginHandler(req, env);
      if (path === "/api/logout" && method === "POST")
        return logoutHandler();
      const authed = PUBLIC_PATHS.has(path) || await isAuthed(req, env);
      if (!authed) {
        if (path.startsWith("/api/"))
          return err("No autenticado", 401);
        return Response.redirect(new URL("/login", req.url).toString(), 302);
      }
      if (path.startsWith("/api/"))
        return await handleApi(req, env, path, method);
      return env.ASSETS.fetch(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      console.error("[api error]", msg);
      return err(msg, 400);
    }
  }
};
async function handleApi(req, env, path, method) {
  const db = env.DB;
  if (path === "/api/data" && method === "GET") {
    return json(await getAllData(db));
  }
  if (path === "/api/gastos" && method === "POST") {
    return json(await agregarGasto(db, await readJson(req)));
  }
  const matchEditarGasto = path.match(/^\/api\/gastos\/(\d+)$/);
  if (matchEditarGasto && method === "PUT") {
    const id = Number(matchEditarGasto[1]);
    const body = await readJson(req);
    return json(await editarGasto(db, { ...body, row: id }));
  }
  if (matchEditarGasto && method === "DELETE") {
    const id = Number(matchEditarGasto[1]);
    return json(await eliminarGasto(db, id));
  }
  if (path === "/api/gastos/bulk-delete" && method === "POST") {
    const body = await readJson(req);
    const rows = (body.rows ?? []).map(Number);
    return json(await eliminarGastosBulk(db, rows));
  }
  const matchEstado = path.match(/^\/api\/gastos\/(\d+)\/estado$/);
  if (matchEstado && method === "POST") {
    const id = Number(matchEstado[1]);
    const body = await readJson(req);
    return json(await toggleEstado(db, id, String(body.estado ?? "Pagado")));
  }
  if (path === "/api/ingresos" && method === "POST") {
    const body = await readJson(req);
    return json(await editarIngreso(db, body.row, Number(body.monto)));
  }
  if (path === "/api/tc" && method === "POST") {
    const body = await readJson(req);
    return json(await editarTC(db, Number(body.tc)));
  }
  if (path === "/api/cierre-tarjeta" && method === "POST") {
    const body = await readJson(req);
    return json(await editarCierreTarjeta(db, String(body.fecha ?? "")));
  }
  if (path === "/api/rendimiento" && method === "POST") {
    const body = await readJson(req);
    return json(await agregarRendimiento(db, String(body.billetera ?? ""), Number(body.monto)));
  }
  if (path === "/api/origenes" && method === "POST") {
    const body = await readJson(req);
    return json(await saveOrigenes(db, body.origenes ?? []));
  }
  if (path === "/api/categorias" && method === "POST") {
    const body = await readJson(req);
    return json(await saveCategorias(db, body.categorias ?? []));
  }
  if (path === "/api/plantillas" && method === "POST") {
    const body = await readJson(req);
    return json(await savePlantillas(db, body.plantillas ?? []));
  }

  if (path === "/api/tarjeta/parse" && method === "POST") {
    // El body son los bytes crudos del .xlsx. No se guarda nada todavia: solo se lee
    // y se cruza con lo ya cargado para que el usuario revise antes de confirmar.
    const buf = await req.arrayBuffer();
    if (!buf || buf.byteLength < 100) throw new Error("El archivo llego vacio.");
    if (buf.byteLength > 8 * 1024 * 1024) throw new Error("El archivo es demasiado grande (mas de 8 MB).");
    return json(await parsearResumenTarjeta(db, buf));
  }
  if (path === "/api/tarjeta/importar" && method === "POST") {
    const body = await readJson(req);
    return json(await importarConsumos(db, body.consumos ?? []));
  }
  if (path === "/api/cierre/preview" && method === "GET") {
    return json(await previewCierreMes(db));
  }
  if (path === "/api/cierre" && method === "POST") {
    const body = await readJson(req);
    return json(await cerrarMes(db, String(body.mes ?? ""), body.anio ?? "", String(body.fecha ?? "")));
  }
  return err("Ruta no encontrada", 404);
}
__name(handleApi, "handleApi");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map