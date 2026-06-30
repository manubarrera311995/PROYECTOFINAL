/**
 * pipeline/runner.js
 * Fase 5 — Orquestación secuencial descarga + análisis para una edición.
 *
 * Fase 6 añadirá paralelismo (--download-workers / --analyze-workers).
 * Por ahora, procesa un id a la vez con estado persistente.
 */

import { existsSync }      from 'node:fs';
import { unlink }          from 'node:fs/promises';
import { join }            from 'node:path';
import { readCsv }         from './csv.js';
import { downloadTrack }   from './download.js';
import { analyzeWav }      from './analyze.js';
import {
  loadProgress, saveProgress,
  updateId, initIds,
  getIdsByStatus, countByStatus,
} from './progress.js';

// ─── Opciones por defecto ─────────────────────────────────────────────────────

const DEFAULTS = {
  downloadsDir:  'downloads',
  progressDir:   'progress',
  skipExisting:  true,
  deleteWavAfter: false,
  retries:       3,
  retryWaitSec:  5,
  onlyIds:       null,   // array de ids si se quiere filtrar
};

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Procesa una edición completa (un CSV → descargar + analizar todos los ids).
 *
 * @param {object} opts
 * @param {string|number} opts.year
 * @param {string}  opts.csvPath       Ruta al FEP_{year}.csv
 * @param {string}  opts.outputDir     Ruta a DATA_{year}/
 * @param {string}  [opts.downloadsDir]
 * @param {string}  [opts.progressDir]
 * @param {boolean} [opts.skipExisting]
 * @param {boolean} [opts.deleteWavAfter]
 * @param {number}  [opts.retries]
 * @param {number}  [opts.retryWaitSec]
 * @param {string[]} [opts.onlyIds]    Procesar solo estos ids (para retry)
 * @param {'download'|'analyze'|'run'} [opts.mode]  default 'run'
 *
 * @returns {Promise<{ done, failed, skipped, total }>}
 */
export async function runYear(opts) {
  const o = { ...DEFAULTS, ...opts };
  const { year, csvPath, outputDir } = o;

  // 1. Leer CSV
  const rows = await readCsv(csvPath);
  if (!rows.length) throw new Error(`CSV vacío: ${csvPath}`);

  // 2. Cargar progreso
  const state = await loadProgress(year, o.progressDir);
  initIds(state, rows);
  await saveProgress(state, year, o.progressDir);

  // 3. Determinar ids a procesar
  const rowMap = Object.fromEntries(rows.map(r => [r.id, r]));
  let queue = rows.map(r => r.id);

  if (o.onlyIds) {
    queue = queue.filter(id => o.onlyIds.includes(id));
  }

  // Filtrar según modo y estado
  queue = queue.filter(id => {
    const s = state.ids[id]?.status;

    // skip-existing: si JSON válido existe en disco → marcar done
    if (o.skipExisting) {
      const jsonPath = join(outputDir, `${id}.json`);
      if (existsSync(jsonPath)) {
        if (s !== 'done') {
          updateId(state, id, { status: 'done', skippedAt: new Date().toISOString() });
        }
        return false;
      }
    }

    // En modo retry, solo ids fallidos
    if (o.mode === 'retry') return s === 'failed';

    // En modo download, saltar los que ya tienen WAV o están done
    if (o.mode === 'download') return s !== 'done' && s !== 'downloaded';

    // En modo analyze, solo los que tienen WAV descargado
    if (o.mode === 'analyze') {
      const wavPath = join(o.downloadsDir, String(year), `${id}.wav`);
      return existsSync(wavPath) && s !== 'done';
    }

    // Modo run: todo lo que no esté done
    return s !== 'done';
  });

  await saveProgress(state, year, o.progressDir);

  const totals = countByStatus(state);
  console.log(`\n[${year}] ${rows.length} canciones | queue: ${queue.length} | ya procesadas: ${totals.done} | fallidas: ${totals.failed}`);

  if (!queue.length) {
    console.log(`[${year}] Nada que procesar.\n`);
    return summarize(state);
  }

  // 4. Procesar
  let processed = 0;
  for (const id of queue) {
    const row     = rowMap[id];
    const wavPath = join(o.downloadsDir, String(year), `${id}.wav`);
    const jsonPath = join(outputDir, `${id}.json`);

    process.stdout.write(`\n  [${++processed}/${queue.length}] ${id} — ${row.banda} - ${row.cancion}\n`);

    try {
      // ── Descarga ──
      if (o.mode !== 'analyze') {
        const alreadyDownloaded = existsSync(wavPath) && state.ids[id]?.status === 'downloaded';
        if (!alreadyDownloaded) {
          updateId(state, id, { status: 'downloading' });
          await saveProgress(state, year, o.progressDir);

          const dl = await downloadTrack({
            id, banda: row.banda, cancion: row.cancion, year,
            outputDir:   o.downloadsDir,
            retries:     o.retries,
            retryWaitSec: o.retryWaitSec,
          });

          updateId(state, id, {
            status:              'downloaded',
            downloadTitle:       dl.videoTitle,
            downloadDurationSec: dl.durationSec,
            downloadedAt:        new Date().toISOString(),
          });
          await saveProgress(state, year, o.progressDir);
        }

        if (o.mode === 'download') continue;
      }

      // ── Análisis ──
      updateId(state, id, { status: 'analyzing' });
      await saveProgress(state, year, o.progressDir);

      await analyzeWav({
        wavPath,
        outputPath: jsonPath,
        metadata:   { id, banda: row.banda, cancion: row.cancion },
      });

      updateId(state, id, {
        status:     'done',
        finishedAt: new Date().toISOString(),
      });
      await saveProgress(state, year, o.progressDir);
      process.stdout.write(`     ✓ done\n`);

      // ── Borrar WAV opcional ──
      if (o.deleteWavAfter && existsSync(wavPath)) {
        await unlink(wavPath);
      }

    } catch (err) {
      const phase = state.ids[id]?.status === 'downloading'  ? 'download'
                  : state.ids[id]?.status === 'analyzing'    ? 'analyze'
                  : 'unknown';
      updateId(state, id, {
        status:   'failed',
        phase,
        error:    err.message.slice(0, 200),
        attempts: (state.ids[id]?.attempts || 0) + 1,
        failedAt: new Date().toISOString(),
      });
      await saveProgress(state, year, o.progressDir);
      process.stdout.write(`     ✗ ${phase}: ${err.message.slice(0, 80)}\n`);
    }
  }

  const final = summarize(state);
  console.log(`\n[${year}] Resultado: ${final.done} OK | ${final.failed} fallidos | ${final.skipped} saltados\n`);
  return final;
}

// ─── Solo descarga ────────────────────────────────────────────────────────────

export async function downloadYear(opts) {
  return runYear({ ...opts, mode: 'download' });
}

// ─── Solo análisis ────────────────────────────────────────────────────────────

export async function analyzeYear(opts) {
  return runYear({ ...opts, mode: 'analyze' });
}

// ─── Reintentar fallidos ──────────────────────────────────────────────────────

export async function retryYear(opts) {
  // Resetear estado de failed → pending antes de reintentar
  const state = await loadProgress(opts.year, opts.progressDir || DEFAULTS.progressDir);
  const failedIds = getIdsByStatus(state, 'failed');

  if (!failedIds.length) {
    console.log(`[${opts.year}] No hay ids fallidos.`);
    return summarize(state);
  }

  for (const id of failedIds) {
    updateId(state, id, { status: 'pending', error: undefined, retrying: true });
  }
  await saveProgress(state, opts.year, opts.progressDir || DEFAULTS.progressDir);

  return runYear({ ...opts, mode: 'run', onlyIds: failedIds });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function summarize(state) {
  const c = countByStatus(state);
  return { done: c.done, failed: c.failed, skipped: 0, total: c.total };
}
