/**
 * Prueba de Fase 3 — descarga 1 canción del FEP_2013.csv
 * y verifica que el WAV existe con el tamaño correcto.
 */

import { existsSync, statSync } from 'node:fs';
import { join, dirname }        from 'node:path';
import { fileURLToPath }        from 'node:url';
import { readCsv }              from '../pipeline/csv.js';
import { downloadTrack }        from '../pipeline/download.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT   = join(__dirname, '..');
const CSV_PATH  = join(PROJECT, '..', 'audio-dna', 'FEP_2013.csv');
const DL_DIR    = join(PROJECT, 'downloads');

async function main() {
  console.log('── Test Fase 3: pipeline/download.js ──\n');

  const rows = await readCsv(CSV_PATH);
  console.log(`CSV cargado: ${rows.length} canciones`);

  // Usar DE_3 "Telescopio" — título corto, fácil de encontrar
  const track = rows.find(r => r.id === 'DE_3') || rows[0];
  console.log(`\nDescargando: [${track.id}] ${track.banda} - ${track.cancion}\n`);

  const result = await downloadTrack({
    ...track,
    year:      2013,
    outputDir: DL_DIR,
    retries:   2,
  });

  console.log('\nResultado:');
  console.log('  wavPath:    ', result.wavPath);
  console.log('  videoTitle: ', result.videoTitle);
  console.log('  durationSec:', result.durationSec, `(${Math.floor(result.durationSec/60)}:${String(result.durationSec%60).padStart(2,'0')})`);
  console.log('  searchQuery:', result.searchQuery);

  if (!existsSync(result.wavPath)) {
    console.error('\n✗ El archivo WAV no existe en disco.');
    process.exit(1);
  }

  const bytes = statSync(result.wavPath).size;
  console.log(`\n  Tamaño WAV: ${(bytes / 1024 / 1024).toFixed(2)} MB`);

  if (bytes < 100_000) {
    console.error('✗ WAV demasiado pequeño — posible error.');
    process.exit(1);
  }

  console.log('\n✅ Descarga OK\n');
}

main().catch(err => { console.error(err); process.exit(1); });
