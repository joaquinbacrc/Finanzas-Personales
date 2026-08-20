#!/usr/bin/env node
// Guardrail: avisa si se toco la logica compartida en src/ sin tocar worker.js.
//
// Por que existe: wrangler.toml apunta a main = "worker.js", asi que Cloudflare sirve
// ESE archivo. worker.js es un bundle de esbuild de una version async/D1 cuyos fuentes
// (incluido src/worker.ts) NO estan en el repo. Los src/*.ts que si estan son la version
// sincrona de Express + node:sqlite del deploy viejo de Railway, que esta muerto.
//
// Consecuencia: editar src/ NO cambia produccion y no da ningun sintoma. Este check
// convierte ese silencio en un aviso.
//
// NO intentes generar worker.js desde src/ con esbuild: produciria codigo sincrono de
// node:sqlite corriendo en Workers y la app se cae entera.

import { execSync } from 'node:child_process';

// Archivos cuya logica esta duplicada entre src/ (legado) y worker.js (produccion).
const COMPARTIDOS = ['src/auth.ts', 'src/db.ts', 'src/services/finanzas.ts'];
const RUNTIME = 'worker.js';

function cambiados() {
  // Working tree + staged, contra HEAD.
  const out = execSync('git diff --name-only HEAD', { encoding: 'utf8' });
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}

const tocados = cambiados();
const logicaTocada = COMPARTIDOS.filter((f) => tocados.has(f));
const runtimeTocado = tocados.has(RUNTIME);

if (logicaTocada.length && !runtimeTocado) {
  console.error('\n  AVISO: tocaste logica en src/ pero no worker.js\n');
  for (const f of logicaTocada) console.error(`    - ${f}`);
  console.error(`\n  Cloudflare sirve ${RUNTIME}, no src/. Este cambio NO va a llegar a`);
  console.error('  produccion y no vas a ver ningun error: la app va a seguir corriendo');
  console.error('  la version anterior.\n');
  console.error(`  Aplica el mismo cambio a mano en ${RUNTIME} (es async/D1, no sincrono).`);
  console.error('  Detalle en CLAUDE.md, seccion "worker.js es el fuente de produccion".\n');
  process.exit(1);
}

if (runtimeTocado && !logicaTocada.length) {
  console.log(`  Nota: tocaste ${RUNTIME} y ningun src/. Correcto si el cambio es solo del`);
  console.log('  worker; si es logica compartida, replicalo en src/ para que no divergan.\n');
}

console.log('  check:worker OK');
