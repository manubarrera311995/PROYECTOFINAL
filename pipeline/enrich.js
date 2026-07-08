/**
 * pipeline/enrich.js
 * Enriquecimiento Spotify de JSONs ya generados.
 *
 * Lee todos los {id}.json de un DATA_{year}/, consulta Spotify por cada track
 * que aún no fue enriquecido, y sobreescribe el JSON con:
 *   - spotifyAlbumArt, spotifyGenres, spotifyMatchConfidence
 *   - genre, subgenre, genreExplanation, genreConfidence
 *   - spotifyEnrichedAt  (timestamp; indica que ya fue procesado)
 *
 * Para evitar guardar matches falsos (canción/artista equivocado con
 * confianza engañosamente alta), cada track puede terminar en uno de
 * cuatro resultados:
 *   - enriched      → match de alta confianza, se escriben los campos Spotify.
 *   - candidate     → hubo un resultado pero no pasó los umbrales de
 *                     aceptación; se guarda en `spotifySearchCandidate`
 *                     para revisión manual, SIN tocar los campos principales.
 *   - skipped_cover → el título parece un cover/versión en vivo; se omite
 *                     la búsqueda por completo (casi nunca hay match real).
 *   - not_found     → Spotify no devolvió nada útil.
 *
 * Al terminar, escribe reports/spotify_review_{year}.json con el detalle de
 * los candidatos dudosos y los covers omitidos, para poder auditarlos.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync }                          from 'node:fs';
import { join }                                from 'node:path';
import { enrichTrack, deriveGenre, isLikelyNonOriginalVersion } from './spotify.js';

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
 * @param {string}  [opts.reportDir]  Carpeta reports/ para spotify_review_{year}.json
 * @param {Function} [opts.onProgress]   Callback({ current, total, id, status })
 *
 * @returns {Promise<{ enriched, candidates, skippedCovers, notFound, skipped, failed, total }>}
 */
export async function enrichEdition({ year, dataDir, force = false, overrideMoods = false, reportDir, onProgress }) {
  if (!existsSync(dataDir)) {
    throw new Error(`Directorio no encontrado: ${dataDir}`);
  }

  const files = (await readdir(dataDir))
    .filter(f => f.endsWith('.json'))
    .sort();

  const total = files.length;
  let enriched = 0, notFound = 0, skipped = 0, failed = 0, candidates = 0, skippedCovers = 0;
  const candidateDetails    = [];
  const skippedCoverDetails = [];

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

    // Covers / versiones en vivo casi nunca existen en Spotify bajo el artista
    // que las tocó — buscar solo arriesga guardar la canción original equivocada.
    if (isLikelyNonOriginalVersion(trackName)) {
      process.stdout.write(`  [${String(i + 1).padStart(4)}/${total}] ${id}  ${artist} – ${trackName}  ⚠ cover/en vivo — omitido\n`);
      track.spotifyMatchSkipped = 'cover_or_live';
      track.spotifyEnrichedAt   = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(arr, null, 2), 'utf8');

      skippedCovers++;
      skippedCoverDetails.push({ id, artist, trackName });
      onProgress?.({ current: i + 1, total, id, status: 'skipped_cover' });
      continue;
    }

    try {
      process.stdout.write(`  [${String(i + 1).padStart(4)}/${total}] ${id}  ${artist} – ${trackName}  `);

      const result = await enrichTrack(artist, trackName, { expectedDurationSec: track.duration });

      if (result.status === 'accepted') {
        // Actualizar campos Spotify
        track.spotifyTrackName       = result.spotifyTrackName;
        track.spotifyArtist          = result.spotifyArtist;
        track.spotifyAlbumArt        = result.spotifyAlbumArt;
        track.spotifyGenres          = result.spotifyGenres;
        track.spotifyMatchConfidence = result.spotifyMatchConfidence;
        if (result.spotifyId) track.spotifyId = result.spotifyId;
        delete track.spotifySearchCandidate;
        delete track.spotifyMatchReason;

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

      } else if (result.status === 'candidate') {
        // No sobreescribimos los campos principales — solo dejamos el
        // candidato disponible para revisión manual posterior.
        track.spotifySearchCandidate = result.candidate;
        track.spotifyMatchReason     = result.reason;

        process.stdout.write(`⚠ candidato dudoso (${result.candidate.combinedScore}%, ${result.reason}) — revisar\n`);
        candidates++;
        candidateDetails.push({ id, artist, trackName, ...result.candidate, reason: result.reason });
        onProgress?.({ current: i + 1, total, id, status: 'candidate' });

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

  const summary = { enriched, candidates, skippedCovers, notFound, skipped, failed, total };
  console.log(
    `\n[${year}] Spotify: ${enriched} enriquecidos | ${candidates} candidatos dudosos | ` +
    `${skippedCovers} covers/en vivo omitidos | ${notFound} no encontrados | ${skipped} saltados | ${failed} errores\n`
  );

  if (reportDir) {
    await writeSpotifyReviewReport({
      year, reportDir,
      candidates:    candidateDetails,
      skippedCovers: skippedCoverDetails,
    });
  }

  return summary;
}

// ─── Reporte de auditoría (candidatos dudosos + covers omitidos) ────────────

/**
 * Escribe reports/spotify_review_{year}.json con el detalle de los matches
 * que quedaron pendientes de revisión manual (candidatos dudosos) y de las
 * canciones que se omitieron por parecer covers/versiones en vivo.
 *
 * @param {object} opts
 * @param {string|number} opts.year
 * @param {string} opts.reportDir
 * @param {object[]} opts.candidates
 * @param {object[]} opts.skippedCovers
 */
async function writeSpotifyReviewReport({ year, reportDir, candidates, skippedCovers }) {
  await mkdir(reportDir, { recursive: true });

  const report = {
    year:               Number(year),
    generatedAt:        new Date().toISOString(),
    candidatesCount:    candidates.length,
    skippedCoversCount: skippedCovers.length,
    candidates,
    skippedCovers,
  };

  const reportPath = join(reportDir, `spotify_review_${year}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  if (candidates.length || skippedCovers.length) {
    console.log(
      `[${year}] ⚠ Revisión Spotify: ${candidates.length} candidato(s) dudoso(s), ` +
      `${skippedCovers.length} cover(s)/en vivo omitido(s) → ${reportPath}\n`
    );
  }

  return report;
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
