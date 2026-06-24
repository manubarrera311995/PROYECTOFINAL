#!/usr/bin/env node
/**
 * Copia models/ desde el repo hermano audio-dna.
 * Ejecutar una vez tras clonar: npm run setup:models
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = resolve(ROOT, '../audio-dna/models');
const TARGET = join(ROOT, 'models');

const REQUIRED = [
  'mood_happy-musicnn',
  'mood_relaxed-musicnn',
  'mood_aggressive-musicnn',
  'danceability-musicnn',
];

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`No se encontró la carpeta de modelos en:\n  ${SOURCE}`);
    console.error('Asegúrate de tener audio-dna como repo hermano (../audio-dna).');
    process.exit(1);
  }

  mkdirSync(TARGET, { recursive: true });

  const entries = readdirSync(SOURCE, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const src = join(SOURCE, entry.name);
    const dst = join(TARGET, entry.name);
    cpSync(src, dst, { recursive: true, force: true });
    copied++;
    console.log(`  ✓ ${entry.name}`);
  }

  const missing = REQUIRED.filter((name) => !existsSync(join(TARGET, name)));
  if (missing.length) {
    console.error('\nFaltan modelos requeridos:', missing.join(', '));
    process.exit(1);
  }

  console.log(`\nListo: ${copied} carpetas copiadas a models/`);
}

main();
