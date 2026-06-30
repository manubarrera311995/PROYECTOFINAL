/**
 * Prueba de Fase 4 — analiza el WAV de DE_3 y escribe el JSON.
 * Requiere haber ejecutado antes: npm run test:download
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname }            from 'node:path';
import { fileURLToPath }            from 'node:url';
import { analyzeWav }               from '../pipeline/analyze.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT   = join(__dirname, '..');

const WAV_PATH  = join(PROJECT, 'downloads', '2013', 'DE_3.wav');
const OUT_PATH  = join(PROJECT, 'downloads', '2013', 'DE_3.json');  // carpeta temporal de prueba

const METADATA  = {
  id:     'DE_3',
  banda:  'Diamante Eléctrico',
  cancion: 'Telescopio',
};

const REQUIRED = [
  'filename', 'danceability', 'happy', 'sad', 'relaxed', 'aggressive',
  'energy', 'tempo', 'nostalgia', 'oscuridad', 'engagement',
  'duration', 'sampleRate', 'keyNote', 'scale', 'moodSource',
  'spotifyTrackName', 'spotifyArtist', 'genre', 'subgenre',
  'genreExplanation', 'genreConfidence',
];

async function main() {
  console.log('── Test Fase 4: pipeline/analyze.js ──\n');

  if (!existsSync(WAV_PATH)) {
    console.error(`WAV no encontrado: ${WAV_PATH}`);
    console.error('Ejecuta primero: npm run test:download');
    process.exit(1);
  }

  console.log(`Analizando: ${WAV_PATH}\n`);
  const t0 = Date.now();

  const result = await analyzeWav({
    wavPath:    WAV_PATH,
    outputPath: OUT_PATH,
    metadata:   METADATA,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nAnálisis completado en ${elapsed} s\n`);

  console.log('── Campos del descriptor ──');
  for (const field of REQUIRED) {
    if (!(field in result)) {
      console.error(`  ✗ Falta: ${field}`);
    } else {
      console.log(`  ✓ ${field.padEnd(22)}: ${JSON.stringify(result[field])}`);
    }
  }

  // Verificar que el JSON fue escrito correctamente
  console.log('\n── JSON escrito ──');
  if (!existsSync(OUT_PATH)) {
    console.error('✗ Archivo JSON no creado.');
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    console.error('✗ El JSON no es un array de un elemento.');
    process.exit(1);
  }
  console.log(`  ✓ ${OUT_PATH}`);
  console.log(`  ✓ Formato: array[1]`);
  console.log(`\n  moodSource : ${result.moodSource}`);
  console.log(`  duration   : ${result.duration?.toFixed(1)} s`);
  console.log(`  happy      : ${result.happy}   sad: ${result.sad}`);
  console.log(`  relaxed    : ${result.relaxed}   aggressive: ${result.aggressive}`);
  console.log(`  nostalgia  : ${result.nostalgia}   oscuridad: ${result.oscuridad}`);

  console.log('\n✅ analyzeWav OK\n');
}

main().catch(err => { console.error(err); process.exit(1); });
