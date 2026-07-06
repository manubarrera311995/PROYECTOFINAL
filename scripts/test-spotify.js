#!/usr/bin/env node
/**
 * scripts/test-spotify.js
 * Verifica que las credenciales de Spotify funcionen y hace una búsqueda
 * de prueba con una canción conocida.
 *
 * Uso:
 *   npm run test:spotify
 */

import 'dotenv/config';
import { pingSpotify, enrichTrack, deriveGenre } from '../pipeline/spotify.js';

const TEST_ARTIST = 'Diamante Eléctrico';
const TEST_TRACK  = 'Telescopio';

async function main() {
  console.log('\n── Test Spotify ─────────────────────────────────────────\n');

  // 1. Verificar credenciales
  console.log('1. Verificando credenciales…');
  const { ok, message } = await pingSpotify();
  if (!ok) {
    console.error(`   ✗ ${message}`);
    console.error('\n   Asegúrate de tener SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en .env\n');
    process.exit(1);
  }
  console.log(`   ✓ ${message}`);

  // 2. Búsqueda de prueba
  console.log(`\n2. Buscando: "${TEST_ARTIST} – ${TEST_TRACK}"…`);
  const result = await enrichTrack(TEST_ARTIST, TEST_TRACK);

  if (!result) {
    console.warn('   – No se encontró el track de prueba (puede ser problema de región)');
  } else {
    console.log(`   ✓ Encontrado con confianza ${result.spotifyMatchConfidence}%`);
    console.log(`     Track:   ${result.spotifyTrackName}`);
    console.log(`     Artista: ${result.spotifyArtist}`);
    console.log(`     AlbumArt: ${result.spotifyAlbumArt ?? '(sin imagen)'}`);
    console.log(`     Géneros Spotify: ${result.spotifyGenres.join(', ') || '(vacío)'}`);

    // 3. Derivación de género
    const derived = deriveGenre(result.spotifyGenres);
    console.log(`\n3. Género derivado:`);
    console.log(`     Género:    ${derived.genre    || '(sin clasificar)'}`);
    console.log(`     Subgénero: ${derived.subgenre || '(sin subgénero)'}`);
    console.log(`     Confianza: ${derived.confidence}%`);
    console.log(`     Explicación: ${derived.explanation}`);
  }

  console.log('\n── OK — Spotify listo ───────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n✗ Error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
