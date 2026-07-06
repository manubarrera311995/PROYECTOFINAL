/**
 * pipeline/enrich.js
 * Enriquecimiento Spotify de JSONs ya generados.
 *
 * Lee todos los {id}.json de un DATA_{year}/, consulta Spotify por cada track
 * que aún no fue enriquecido, y sobreescribe el JSON con:
 *   - spotifyAlbumArt, spotifyGenres, spotifyMatchConfidence
 *   - genre, subgenre, genreExplanation, genreConfidence
 *   - spotifyEnrichedAt  (timestamp; indica que ya fue procesado)
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync }                   from 'node:fs';
import { join }                         from 'node:path';
import { enrichTrack, deriveGenre }     from './spotify.js';

const RATE_LIMIT_MS = 150; // pausa entre requests para no saturar la API

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Enriquece todos los JSONs de una edición con datos de Spotify.
 *
 * @param {object}  opts
 * @param {string|number} opts.year
 * @param {string}  opts.dataDir      Carpeta DATA_{year}/ con los .json
 * @param {boolean} [opts.force]      Reprocesar aunque ya tenga spotifyEnrichedAt
 * @param {boolean} [opts.overrideMoods]  Reservado para uso futuro
 * @param {Function} [opts.onProgress]   Callback({ current, total, id, found })
 *
 * @returns {Promise<{ enriched, notFound, skipped, failed, total }>}
 */
export async function enrichEdition({ year, dataDir, force = false, overrideMoods = false, onProgress }) {
  if (!existsSync(dataDir)) {
    throw new Error(`Directorio no encontrado: ${dataDir}`);
  }

  const files = (await readdir(dataDir))
    .filter(f => f.endsWith('.json'))
    .sort();

  const total = files.length;
  let enriched = 0, notFound = 0, skipped = 0, failed = 0;

  console.log(`\n[${year}] Enriqueciendo ${total} tracks con Spotify…\n`);

  for (let i = 0; i < files.length; i++) {
    const file     = files[i];
    const filePath = join(dataDir, file);
    const id       = file.replace('.json', '');

    // Leer JSON (array de un elemento)
    let arr, track;
    try {
      const raw = await readFile(filePath, 'utf8');
      arr   = JSON.parse(raw);
      track = Array.isArray(arr) ? arr[0] : arr;
    } catch (err) {
      console.warn(`  [${id}] ✗ error leyendo JSON: ${err.message}`);
      failed++;
      onProgress?.({ current: i + 1, total, id, status: 'error' });
      continue;
    }

    // Saltar si ya fue enriquecido (a menos que --force)
    if (!force && track.spotifyEnrichedAt) {
      skipped++;
      onProgress?.({ current: i + 1, total, id, status: 'skipped' });
      continue;
    }

    const artist    = track.spotifyArtist    || track.filename?.split(' - ')[1] || '';
    const trackName = track.spotifyTrackName || track.filename?.split(' - ')[0] || '';

    if (!artist || !trackName) {
      console.warn(`  [${id}] ✗ sin artista/canción — saltando`);
      skipped++;
      onProgress?.({ current: i + 1, total, id, status: 'skipped' });
      continue;
    }

    try {
      process.stdout.write(`  [${String(i + 1).padStart(4)}/${total}] ${id}  ${artist} – ${trackName}  `);

      const result = await enrichTrack(artist, trackName);

      if (result) {
        // Actualizar campos Spotify
        track.spotifyTrackName       = result.spotifyTrackName;
        track.spotifyArtist          = result.spotifyArtist;
        track.spotifyAlbumArt        = result.spotifyAlbumArt;
        track.spotifyGenres          = result.spotifyGenres;
        track.spotifyMatchConfidence = result.spotifyMatchConfidence;
        if (result.spotifyId) track.spotifyId = result.spotifyId;

        // Derivar género si el track no tiene uno o si se fuerza
        const hasGenre = track.genre && track.genre !== '';
        if (!hasGenre || force) {
          const derived = deriveGenre(result.spotifyGenres);
          if (derived.genre) {
            track.genre            = derived.genre;
            track.subgenre         = derived.subgenre;
            track.genreExplanation = derived.explanation;
            track.genreConfidence  = derived.confidence;
          }
        }

        process.stdout.write(`✓ conf:${result.spotifyMatchConfidence}% ${result.spotifyGenres[0] || ''}\n`);
        enriched++;
        onProgress?.({ current: i + 1, total, id, status: 'enriched', confidence: result.spotifyMatchConfidence });
      } else {
        process.stdout.write(`– no encontrado\n`);
        notFound++;
        onProgress?.({ current: i + 1, total, id, status: 'not_found' });
      }

      // Marcar como procesado (aunque no se haya encontrado)
      track.spotifyEnrichedAt = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(arr, null, 2), 'utf8');

    } catch (err) {
      process.stdout.write(`✗ ${err.message.slice(0, 80)}\n`);
      failed++;
      onProgress?.({ current: i + 1, total, id, status: 'error' });
    }

    // Pausa entre requests
    if (i < files.length - 1) await sleep(RATE_LIMIT_MS);
  }

  const summary = { enriched, notFound, skipped, failed, total };
  console.log(
    `\n[${year}] Spotify: ${enriched} enriquecidos | ` +
    `${notFound} no encontrados | ${skipped} saltados | ${failed} errores\n`
  );
  return summary;
}

/**
 * Devuelve cuántos JSONs de un directorio ya tienen spotifyEnrichedAt.
 */
export async function enrichStats(dataDir) {
  if (!existsSync(dataDir)) return null;

  const files = (await readdir(dataDir)).filter(f => f.endsWith('.json'));
  let enriched = 0, total = 0;

  for (const file of files) {
    try {
      const raw   = await readFile(join(dataDir, file), 'utf8');
      const arr   = JSON.parse(raw);
      const track = Array.isArray(arr) ? arr[0] : arr;
      total++;
      if (track.spotifyEnrichedAt) enriched++;
    } catch { /* ignorar JSONs corruptos */ }
  }

  return { enriched, total, pending: total - enriched };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
