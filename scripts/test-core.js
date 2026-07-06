#!/usr/bin/env node
/**
 * Prueba rápida de core/analyzer.js — verifica que analyzeBuffer devuelve
 * los campos clave del JSON sin errores, usando PCM sintético.
 */

import { analyzeBuffer } from '../core/analyzer.js';

const SR  = 16000;
const SEC = 30; // 30 s de tono sintético

function makeSyntheticPCM(sr, seconds, hz = 440) {
  const n   = sr * seconds;
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Tono + algo de ruido para que las features no sean degeneradas
    pcm[i] = 0.3 * Math.sin(2 * Math.PI * hz * i / sr)
           + 0.05 * (Math.random() * 2 - 1);
  }
  return pcm;
}

const REQUIRED_FIELDS = [
  'happy', 'sad', 'relaxed', 'aggressive', 'danceability',
  'energy', 'tempo', 'nostalgia', 'oscuridad', 'engagement',
  'duration', 'sampleRate', 'keyNote', 'scale', 'loudness_db',
  'moodSource', 'genre', 'subgenre',
  'spotifyTrackName', 'spotifyArtist', 'spotifyAlbumArt',
];

async function main() {
  console.log('── Test: core/analyzer.js ──\n');

  const pcm = makeSyntheticPCM(SR, SEC);
  console.log(`PCM sintético: ${SEC} s @ ${SR} Hz  (${pcm.length} muestras)\n`);

  let result;
  try {
    result = await analyzeBuffer(pcm, SR);
  } catch (err) {
    console.error('analyzeBuffer lanzó error:', err);
    process.exit(1);
  }

  console.log('Resultado de analyzeBuffer:\n');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n── Verificando campos requeridos ──');
  let ok = true;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in result)) {
      console.error(`  ✗ Falta campo: ${field}`);
      ok = false;
    } else {
      console.log(`  ✓ ${field}: ${JSON.stringify(result[field])}`);
    }
  }

  if (!ok) { process.exit(1); }

  console.log('\n✅ analyzeBuffer OK — todos los campos presentes.');
  console.log(`   moodSource: ${result.moodSource}`);
}

main().catch(err => { console.error(err); process.exit(1); });
