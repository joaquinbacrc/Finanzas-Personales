// =============================================================================
// Carga por voz / texto libre
// =============================================================================
// En iPhone la Web Speech API es poco confiable, sobre todo con la PWA instalada.
// Lo que SI funciona siempre es el microfono del teclado de iOS: el usuario dicta
// en un campo de texto normal. Por eso lo que importa aca no es capturar audio sino
// entender la frase. El boton de microfono es un extra para navegadores que lo
// soporten; la app funciona igual sin el.

const VOZ_UNIDADES = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14,
  quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80,
  noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300,
  cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700,
  ochocientos: 800, novecientos: 900,
};

function vozNormalizar(t) {
  return String(t || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// "veinticinco mil" -> 25000 | "mil quinientos" -> 1500 | "dos millones" -> 2000000
function vozNumeroEnPalabras(tokens) {
  let total = 0, parcial = 0, uso = 0;
  for (const w of tokens) {
    if (VOZ_UNIDADES[w] !== undefined) { parcial += VOZ_UNIDADES[w]; uso++; continue; }
    if (w === 'mil') { parcial = (parcial || 1) * 1000; total += parcial; parcial = 0; uso++; continue; }
    if (w === 'millon' || w === 'millones') { parcial = (parcial || 1) * 1e6; total += parcial; parcial = 0; uso++; continue; }
    if (w === 'y') { uso++; continue; }
    break;
  }
  return { valor: total + parcial, consumidos: uso };
}

// Devuelve { monto, moneda, resto } sacando de la frase lo que se uso.
function vozExtraerMonto(texto) {
  let t = ' ' + texto + ' ';
  let monto = 0, moneda = 'ARS';

  const marcaMoneda = (frag) => {
    if (/\b(dolar|dolares|usd|u\$s|verdes)\b/.test(frag)) moneda = 'USD';
    else if (/\b(euro|euros)\b/.test(frag)) moneda = 'EUR';
  };
  marcaMoneda(t);

  // 1) Numero en digitos, con o sin separadores: "25.000", "25000", "1.234,56", "25,5"
  //    Ojo: "2 de 12" (cuotas) no es un monto; se saca antes de llegar aca.
  const mDig = t.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(mil|millon|millones|lucas|palos|k)?\b/);
  if (mDig) {
    let n = mDig[1];
    if (/\.\d{3}/.test(n)) n = n.replace(/\./g, '').replace(',', '.');   // 25.000 -> 25000
    else n = n.replace(',', '.');
    let v = parseFloat(n);
    const suf = mDig[2];
    if (suf === 'mil' || suf === 'lucas' || suf === 'k') v *= 1000;
    else if (suf === 'millon' || suf === 'millones' || suf === 'palos') v *= 1e6;
    monto = v;
    t = t.replace(mDig[0], ' ');
  } else {
    // 2) Numero en palabras
    const palabras = t.trim().split(' ');
    for (let i = 0; i < palabras.length; i++) {
      const w = palabras[i];
      if (VOZ_UNIDADES[w] === undefined && w !== 'mil') continue;
      const { valor, consumidos } = vozNumeroEnPalabras(palabras.slice(i));
      if (valor > 0) {
        monto = valor;
        palabras.splice(i, consumidos);
        t = ' ' + palabras.join(' ') + ' ';
        break;
      }
    }
  }

  t = t.replace(/\b(pesos|peso|dolares|dolar|usd|u\$s|verdes|euros|euro|mangos)\b/g, ' ');
  return { monto, moneda, resto: t.replace(/\s+/g, ' ').trim() };
}

const VOZ_SINONIMOS_CAT = {
  Comida: ['comida', 'super', 'supermercado', 'almuerzo', 'cena', 'delivery', 'restaurante', 'verduleria', 'carniceria', 'panaderia', 'kiosco', 'cafe'],
  Transporte: ['transporte', 'nafta', 'combustible', 'peaje', 'peajes', 'uber', 'taxi', 'cabify', 'sube', 'estacionamiento', 'cochera', 'auto'],
  Hogar: ['hogar', 'casa', 'alquiler', 'expensas', 'luz', 'gas', 'agua', 'internet', 'ferreteria', 'muebles'],
  Suscripciones: ['suscripcion', 'suscripciones', 'netflix', 'spotify', 'disney', 'youtube', 'icloud', 'plan'],
  Salud: ['salud', 'farmacia', 'medico', 'dentista', 'remedios', 'obra social', 'gimnasio', 'gym'],
  Ocio: ['ocio', 'salida', 'cine', 'bar', 'boliche', 'juego', 'juegos', 'viaje', 'vacaciones'],
  Compras: ['compras', 'ropa', 'zapatillas', 'regalo', 'regalos', 'electro', 'mercadolibre', 'meli'],
};

function vozDetectarCategoria(texto, categorias) {
  const t = ' ' + texto + ' ';
  for (const c of categorias || []) {
    if (t.includes(' ' + vozNormalizar(c) + ' ')) return c;
  }
  for (const [cat, syns] of Object.entries(VOZ_SINONIMOS_CAT)) {
    if (!(categorias || []).includes(cat)) continue;
    if (syns.some(sy => t.includes(' ' + sy + ' '))) return cat;
  }
  return '';
}

function vozDetectarOrigen(texto, origenes) {
  const t = ' ' + texto + ' ';
  // Primero por nombre exacto del origen configurado, incluidos los ultimos 4 digitos.
  for (const o of origenes || []) {
    const n = vozNormalizar(o);
    if (t.includes(' ' + n + ' ')) return o;
    const dig = n.match(/\d{4}/);
    if (dig && t.includes(dig[0])) return o;
  }
  // Despues por como se dice en la vida real.
  const alias = [
    [/\b(mercado ?pago|mp)\b/, 'MP'],
    [/\bnubi\b/, 'NUBI'],
    // Ojo: "5 dolares" indica la MONEDA, no de donde salio la plata. Para elegir
    // Caja USD hay que nombrar la caja explicitamente.
    [/caja/, 'Caja USD'],
    [/\b(visa|tarjeta|credito)\b/, null],   // null = la primera que parezca tarjeta
  ];
  for (const [re, destino] of alias) {
    if (!re.test(t)) continue;
    if (destino && (origenes || []).includes(destino)) return destino;
    if (!destino) {
      const tarjeta = (origenes || []).find(o => /visa|master|amex|tarjeta/i.test(o));
      if (tarjeta) return tarjeta;
    }
  }
  return '';
}

function vozDetectarFecha(texto) {
  const hoy = new Date();
  const fmt = (d) => String(d.getDate()).padStart(2, '0') + '/' +
    String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  if (/\bantea?yer\b/.test(texto)) { const d = new Date(hoy); d.setDate(d.getDate() - 2); return { fecha: fmt(d), usado: 'anteayer' }; }
  if (/\bayer\b/.test(texto)) { const d = new Date(hoy); d.setDate(d.getDate() - 1); return { fecha: fmt(d), usado: 'ayer' }; }
  const m = texto.match(/\bel (\d{1,2})(?:\s*de\s*(\d{1,2}))?\b/);
  if (m) {
    const dia = +m[1], mes = m[2] ? +m[2] : hoy.getMonth() + 1;
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      return { fecha: String(dia).padStart(2, '0') + '/' + String(mes).padStart(2, '0') + '/' + hoy.getFullYear(), usado: m[0] };
    }
  }
  return { fecha: fmt(hoy), usado: '' };
}

// Convierte una frase dictada en los campos de un gasto.
function vozParsearGasto(frase, opciones) {
  const cats = (opciones && opciones.categorias) || [];
  const origs = (opciones && opciones.origenes) || [];
  let t = vozNormalizar(frase);
  if (!t) return null;

  // Las cuotas se sacan ANTES del monto: "en 3 cuotas" tiene un numero que no es plata.
  let cuota = '';
  const mCuotaN = t.match(/\bcuota (\d{1,2}) de (\d{1,2})\b/);
  const mCuotas = t.match(/\ben (\d{1,2}) cuotas\b/) || t.match(/\b(\d{1,2}) cuotas\b/);
  if (mCuotaN) { cuota = mCuotaN[1] + '/' + mCuotaN[2]; t = t.replace(mCuotaN[0], ' '); }
  else if (mCuotas) { cuota = '1/' + mCuotas[1]; t = t.replace(mCuotas[0], ' '); }

  const f = vozDetectarFecha(t);
  if (f.usado) t = t.replace(f.usado, ' ');

  let tipo = 'Variable';
  if (/\b(fijo|fija|mensual|todos los meses)\b/.test(t)) { tipo = 'Fijo'; t = t.replace(/\b(fijo|fija|mensual|todos los meses)\b/g, ' '); }

  let estado = 'Pagado';
  if (/\b(pendiente|impago|sin pagar|a pagar)\b/.test(t)) { estado = 'Pendiente'; t = t.replace(/\b(pendiente|impago|sin pagar|a pagar)\b/g, ' '); }

  const categoria = vozDetectarCategoria(t, cats);
  const imputar = vozDetectarOrigen(t, origs);

  const { monto, moneda, resto } = vozExtraerMonto(t);

  // El motivo es lo que sobra: se sacan las muletillas y las palabras ya usadas.
  let motivo = resto
    .replace(/\b(con|la|el|de|del|en|por|para|un|una|unos|unas|mi|me|gaste|gastar|pague|pagar|compre|comprar|puse|anota|anotar|carga|cargar|agrega|agregar|fue|son|es|y|a|al|tarjeta|credito|debito)\b/g, ' ')
    .replace(/\b(mercado ?pago|visa|master|amex|nubi|mp)\b/g, ' ');
  if (imputar) {
    // split/join en vez de RegExp dinamico: el nombre del origen lo elige el usuario y
    // puede traer caracteres que en una regex significan otra cosa.
    const ni = vozNormalizar(imputar);
    motivo = motivo.split(ni).join(' ');
    // "visa 4305": los 4 digitos identifican la tarjeta, no son parte del motivo.
    const dig = ni.match(/\d{4}/);
    if (dig) motivo = motivo.split(dig[0]).join(' ');
  }
  motivo = motivo.replace(/\s+/g, ' ').trim();
  if (motivo) motivo = motivo.charAt(0).toUpperCase() + motivo.slice(1);

  return {
    motivo, monto, moneda, categoria, imputar, tipo, cuota, estado,
    fecha: f.fecha,
    // Para poder decirle al usuario que fue lo que no se entendio.
    faltaMonto: !monto,
    faltaMotivo: !motivo,
  };
}
