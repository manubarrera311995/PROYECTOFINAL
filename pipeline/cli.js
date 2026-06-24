#!/usr/bin/env node
/**
 * CLI del pipeline — Fase 5
 * Uso: npm run pipeline -- run --year 2013 ...
 */

import 'dotenv/config';

const HELP = `
audio-dna-pipeline — CLI (en construcción)

Uso:
  npm run pipeline -- <comando> [opciones]

Comandos (Fase 5+):
  run          Descargar y analizar una edición o --all
  download     Solo descarga WAV
  analyze      Solo análisis WAV → JSON
  validate     Reporte de calidad
  retry        Reintentar ids fallidos
  status       Ver progreso de una edición

Ejemplo (cuando esté implementado):
  npm run pipeline -- run --year 2013 \\
    --csv ../audio-dna/FEP_2013.csv \\
    --output-dir ../audio-dna/DATA_2013

Estado actual: Paso 0 — esqueleto. Siguiente: Fase 1 (npm run test:models).
`.trim();

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(HELP);
  process.exit(0);
}

console.error(`Comando "${command}" aún no implementado (Fase 5).`);
console.error('Ejecuta: npm run pipeline -- --help');
process.exit(1);
