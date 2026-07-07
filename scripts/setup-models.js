#!/usr/bin/env node
/**
 * Verifica que los modelos Essentia estén presentes en models/.
 * Los modelos vienen incluidos en el repositorio; este script
 * confirma que la carpeta no fue borrada ni quedó vacía.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'models');

const REQUIRED = [
  'mood_happy-musicnn',
  'mood_relaxed-musicnn',
  'mood_aggressive-musicnn',
  'danceability-musicnn',
];

function main() {
  const missing = REQUIRED.filter(name => !existsSync(join(MODELS_DIR, name)));

  if (missing.length) {
    console.error('\n✗ Faltan modelos en la carpeta models/:');
    missing.forEach(m => console.error(`    - ${m}`));
    console.error('\n  Asegúrate de que la carpeta models/ no fue borrada.');
    console.error('  Si clonaste el repositorio, verifica que los archivos se descargaron correctamente.\n');
    process.exit(1);
  }

  console.log(`\n✓ Todos los modelos están presentes (${REQUIRED.length}/${REQUIRED.length})\n`);
}

main();
