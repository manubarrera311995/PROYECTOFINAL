/**
 * pipeline/runner.js
 * Orquestación de descarga + análisis con workers concurrentes.
 *
 * Modelo de concurrencia:
 *   Queue de ids → [N download workers] → analyzeQueue → [M analyze workers] → done
 *
 * Con workers=1 el comportamiento es secuencial.
 * Con workers>1, las descargas se solapan entre sí y con los análisis:
 *   mientras un WAV se analiza, otros se están descargando en paralelo.
 */

import { existsSync }      from 'node:fs';
import { unlink }          from 'node:fs/promises';
import { join, resolve }    from 'node:path';
import { readCsv }         from './csv.js';
import { downloadTrack }   from './download.js';
import { analyzeWav }      from './analyze.js';
import { validateEdition } from './validate.js';
import { enrichEdition }   from './enrich.js';
import {
  loadProgress, saveProgress,
  updateId, initIds,
  getIdsByStatus, countByStatus,
} from './progress.js';

// ─── Opciones por defecto ─────────────────────────────────────────────────────

const DEFAULTS = {
  downloadsDir:    'downloads',
  progressDir:     'progress',
  reportsDir:      'reports',
  skipExisting:    true,
  deleteWavAfter:  false,
  retries:         3,
  retryWaitSec:    5,
  downloadWorkers: 1,
  analyzeWorkers:  1,
  onlyIds:         null,
};

// ─── Pool de concurrencia (semáforo async) ────────────────────────────────────

/**
 * Limita la ejecución concurrente de funciones async.
 * pool.run(fn) encola fn y la ejecuta cuando hay un slot libre.
 */
class Pool {
  constructor(concurrency) {
    this.concurrency = Math.max(1, concurrency);
    this.running     = 0;
    this.queue       = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      const task = async () => {
        this.running++;
        try   { resolve(await fn()); }
        catch (err) { reject(err); }
        finally {
          this.running--;
          if (this.queue.length) this.queue.shift()();
        }
      };
      if (this.running < this.concurrency) task();
      else this.queue.push(task);
    });
  }
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Procesa una edición completa con workers concurrentes.
 *
 * @param {object} opts
 * @param {string|number} opts.year
 * @param {string}  opts.csvPath
 * @param {string}  opts.outputDir
 * @param {string}  [opts.downloadsDir]
 * @param {string}  [opts.progressDir]
 * @param {boolean} [opts.skipExisting]
 * @param {boolean} [opts.deleteWavAfter]
 * @param {number}  [opts.retries]
 * @param {number}  [opts.retryWaitSec]
 * @param {number}  [opts.downloadWorkers]   Descargas simultáneas (default 1)
 * @param {number}  [opts.analyzeWorkers]    Análisis simultáneos  (default 1)
 * @param {string[]} [opts.onlyIds]
 * @param {'download'|'analyze'|'run'} [opts.mode]
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

  // 3. Determinar queue
  const rowMap = Object.fromEntries(rows.map(r => [r.id, r]));
  let queue = rows.map(r => r.id);

  if (o.onlyIds) queue = queue.filter(id => o.onlyIds.includes(id));

  queue = queue.filter(id => {
    const s = state.ids[id]?.status;

    if (o.skipExisting) {
      const jsonPath = join(outputDir, `${id}.json`);
      if (existsSync(jsonPath)) {
        if (s !== 'done') updateId(state, id, { status: 'done', skippedAt: new Date().toISOString() });
        return false;
      }
    }

    if (o.mode === 'retry')    return s === 'failed';
    if (o.mode === 'download') return s !== 'done' && s !== 'downloaded';
    if (o.mode === 'analyze') {
      const wavPath = join(o.downloadsDir, String(year), `${id}.wav`);
      return existsSync(wavPath) && s !== 'done';
    }
    return s !== 'done';
  });

  await saveProgress(state, year, o.progressDir);

  const totals = countByStatus(state);
  const dlW    = o.mode === 'analyze' ? 0 : o.downloadWorkers;
  const anW    = o.mode === 'download' ? 0 : o.analyzeWorkers;
  console.log(
    `\n[${year}] ${rows.length} canciones | queue: ${queue.length} | ` +
    `ya procesadas: ${totals.done} | fallidas: ${totals.failed}` +
    (dlW > 1 || anW > 1 ? ` | workers dl:${dlW} an:${anW}` : '')
  );

  if (!queue.length) {
    console.log(`[${year}] Nada que procesar.\n`);
    return summarize(state);
  }

  // 4. Ejecutar con pools
  const dlPool = new Pool(o.downloadWorkers);
  const anPool = new Pool(o.analyzeWorkers);

  // Mutex liviano para escrituras atómicas del estado (evita race en fs)
  const saveMutex = new Pool(1);
  const persistState = () => saveMutex.run(() => saveProgress(state, year, o.progressDir));

  let processed = 0;
  const total   = queue.length;

  const tasks = queue.map(id => {
    const row      = rowMap[id];
    const wavPath  = join(o.downloadsDir, String(year), `${id}.wav`);
    const jsonPath = join(outputDir, `${id}.json`);
    const num      = ++processed;

    return dlPool.run(async () => {
      process.stdout.write(`\n  [${num}/${total}] ${id} — ${row.banda} - ${row.cancion}\n`);

      try {
        // ── Descarga ──────────────────────────────────────────────────────────
        if (o.mode !== 'analyze') {
          const alreadyDownloaded = existsSync(wavPath) && state.ids[id]?.status === 'downloaded';
          if (!alreadyDownloaded) {
            updateId(state, id, { status: 'downloading' });
            await persistState();

            const dl = await downloadTrack({
              id, banda: row.banda, cancion: row.cancion, year,
              outputDir:    o.downloadsDir,
              retries:      o.retries,
              retryWaitSec: o.retryWaitSec,
            });

            updateId(state, id, {
              status:              'downloaded',
              downloadTitle:       dl.videoTitle,
              downloadDurationSec: dl.durationSec,
              downloadedAt:        new Date().toISOString(),
            });
            await persistState();
          }

          if (o.mode === 'download') return;
        }

        // ── Análisis (pool separado — se solapan con futuras descargas) ──────
        await anPool.run(async () => {
          updateId(state, id, { status: 'analyzing' });
          await persistState();

          await analyzeWav({
            wavPath,
            outputPath: jsonPath,
            metadata:   { id, banda: row.banda, cancion: row.cancion },
          });

          updateId(state, id, { status: 'done', finishedAt: new Date().toISOString() });
          await persistState();
          process.stdout.write(`     ✓ done\n`);

          if (o.deleteWavAfter && existsSync(wavPath)) await unlink(wavPath);
        });

      } catch (err) {
        const phase = state.ids[id]?.status === 'downloading' ? 'download'
                    : state.ids[id]?.status === 'analyzing'   ? 'analyze'
                    : 'unknown';
        updateId(state, id, {
          status:   'failed',
          phase,
          error:    err.message.slice(0, 200),
          attempts: (state.ids[id]?.attempts || 0) + 1,
          failedAt: new Date().toISOString(),
        });
        await persistState();
        process.stdout.write(`     ✗ ${phase}: ${err.message.slice(0, 80)}\n`);
      }
    });
  });

  await Promise.all(tasks);

  const final = summarize(state);
  console.log(`\n[${year}] Resultado: ${final.done} OK | ${final.failed} fallidos | ${final.skipped} saltados\n`);

  // Generar reporte de calidad automáticamente al terminar cada edición
  if (o.mode !== 'download') {
    await validateEdition({
      year,
      dataDir:   outputDir,
      reportDir: resolve(o.reportsDir),
      csvPath,
    }).catch(err => console.warn(`[validate] No se pudo generar reporte: ${err.message}`));
  }

  // Enriquecimiento Spotify opcional (activar con SPOTIFY_ENRICH=true en .env)
  if (o.mode !== 'download' && process.env.SPOTIFY_ENRICH === 'true') {
    await enrichEdition({
      year,
      dataDir:       outputDir,
      force:         false,
      overrideMoods: process.env.SPOTIFY_OVERRIDE_MOODS === 'true',
    }).catch(err => console.warn(`[enrich] Error Spotify: ${err.message}`));
  }

  return final;
}

// ─── Wrappers de modo ─────────────────────────────────────────────────────────

export const downloadYear = opts => runYear({ ...opts, mode: 'download' });
export const analyzeYear  = opts => runYear({ ...opts, mode: 'analyze'  });

export async function retryYear(opts) {
  const progDir = opts.progressDir || DEFAULTS.progressDir;
  const state   = await loadProgress(opts.year, progDir);
  const failedIds = getIdsByStatus(state, 'failed');

  if (!failedIds.length) {
    console.log(`[${opts.year}] No hay ids fallidos.`);
    return summarize(state);
  }

  for (const id of failedIds) {
    updateId(state, id, { status: 'pending', error: undefined, retrying: true });
  }
  await saveProgress(opts.year, progDir, state);

  return runYear({ ...opts, mode: 'run', onlyIds: failedIds });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function summarize(state) {
  const c = countByStatus(state);
  return { done: c.done, failed: c.failed, skipped: 0, total: c.total };
}
