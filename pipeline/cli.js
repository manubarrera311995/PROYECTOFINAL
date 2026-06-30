#!/usr/bin/env node
/**
 * pipeline/cli.js
 * Fase 5 — CLI principal del pipeline audio-dna.
 *
 * Uso: npm run pipeline -- <comando> [opciones]
 * o:   node pipeline/cli.js <comando> [opciones]
 */

import 'dotenv/config';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join }           from 'node:path';
import { writeFile, mkdir }        from 'node:fs/promises';
import { runYear, downloadYear, analyzeYear, retryYear } from './runner.js';
import { loadProgress, countByStatus, getIdsByStatus }  from './progress.js';
import { readCsv } from './csv.js';

// ─── Ayuda ────────────────────────────────────────────────────────────────────

const HELP = `
audio-dna-pipeline — CLI

Uso:
  npm run pipeline -- <comando> [opciones]

Comandos:
  run        Descargar y analizar una o más ediciones
  download   Solo descargar WAV (sin analizar)
  analyze    Solo analizar WAV ya descargados → JSON
  retry      Reintentar ids fallidos
  status     Ver progreso de una edición
  validate   Generar reporte de calidad (reports/quality_{year}.json)

Opciones de alcance:
  --year    N          Procesar una edición (ej. --year 2013)
  --years   N,N,...    Varias ediciones (ej. --years 2013,2014)
  --all                Todas las ediciones en --csv-dir

Opciones de rutas:
  --csv         PATH   CSV de una edición (para --year)
  --csv-dir     PATH   Carpeta con todos los FEP_*.csv (default: ../audio-dna)
  --output-dir  PATH   Carpeta de salida JSON de una edición (para --year)
  --output-base PATH   Carpeta base; genera DATA_{year}/ por edición (default: ../audio-dna)
  --downloads-dir PATH Carpeta de WAVs (default: ./downloads)
  --progress-dir PATH  Carpeta de progreso (default: ./progress)

Opciones de comportamiento:
  --skip-existing      Omitir ids con JSON válido [default: true]
  --no-skip-existing   Reprocesar todo
  --delete-wav-after   Borrar WAV tras análisis exitoso
  --failed-only        (solo retry) Reintentar solo los fallidos

Ejemplos:
  # Una edición
  npm run pipeline -- run --year 2013 \\
    --csv ../audio-dna/FEP_2013.csv \\
    --output-dir ../audio-dna/DATA_2013

  # Todas las ediciones
  npm run pipeline -- run --all \\
    --csv-dir ../audio-dna --output-base ../audio-dna

  # Atajo con rutas fijas
  npm run process:all

  # Reintentar fallidos de 2013
  npm run pipeline -- retry --year 2013 --failed-only

  # Ver progreso
  npm run pipeline -- status --year 2013
`.trim();

// ─── Parser de argumentos ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true; i++;
      } else {
        args[key] = next; i += 2;
      }
    } else {
      args._positional = (args._positional || []).concat(a); i++;
    }
  }
  return args;
}

// ─── Resolución de años y rutas ───────────────────────────────────────────────

function resolveYears(args) {
  if (args.year)   return [String(args.year)];
  if (args.years)  return String(args.years).split(',').map(y => y.trim());
  if (args.all)    return null; // null = detectar desde csv-dir
  return null;
}

const DEFAULT_CSV_DIR     = resolve('..', 'audio-dna');
const DEFAULT_OUTPUT_BASE = resolve('..', 'audio-dna');
const DEFAULT_DL_DIR      = resolve('downloads');
const DEFAULT_PROGRESS    = resolve('progress');

function detectYearsFromCsvDir(csvDir) {
  if (!existsSync(csvDir)) throw new Error(`--csv-dir no encontrado: ${csvDir}`);
  return readdirSync(csvDir)
    .filter(f => /^FEP_\d{4}\.csv$/i.test(f))
    .map(f => f.match(/\d{4}/)[0])
    .sort();
}

function buildYearOpts(year, args) {
  const csvDir     = resolve(args['csv-dir']     || DEFAULT_CSV_DIR);
  const outputBase = resolve(args['output-base'] || DEFAULT_OUTPUT_BASE);
  const dlDir      = resolve(args['downloads-dir'] || DEFAULT_DL_DIR);
  const progDir    = resolve(args['progress-dir']  || DEFAULT_PROGRESS);

  const csvPath   = args.csv
    ? resolve(args.csv)
    : join(csvDir, `FEP_${year}.csv`);
  const outputDir = args['output-dir']
    ? resolve(args['output-dir'])
    : join(outputBase, `DATA_${year}`);

  const skipExisting  = args['no-skip-existing'] ? false : true;
  const deleteWav     = !!args['delete-wav-after'];

  return { year, csvPath, outputDir, downloadsDir: dlDir, progressDir: progDir, skipExisting, deleteWavAfter: deleteWav };
}

// ─── Comandos ─────────────────────────────────────────────────────────────────

async function cmdRun(args, mode = 'run') {
  let years = resolveYears(args);
  const csvDir = resolve(args['csv-dir'] || DEFAULT_CSV_DIR);

  if (!years) years = detectYearsFromCsvDir(csvDir);
  if (!years.length) { console.error('No se encontraron ediciones. Verifica --csv-dir.'); process.exit(1); }

  console.log(`\n▶  ${mode.toUpperCase()} — ediciones: ${years.join(', ')}\n`);

  for (const year of years) {
    const opts = buildYearOpts(year, args);

    if (!existsSync(opts.csvPath)) {
      console.warn(`  [${year}] CSV no encontrado: ${opts.csvPath} — saltando`);
      continue;
    }

    if (mode === 'download') await downloadYear(opts);
    else if (mode === 'analyze') await analyzeYear(opts);
    else                         await runYear(opts);
  }
}

async function cmdRetry(args) {
  let years = resolveYears(args);
  const csvDir = resolve(args['csv-dir'] || DEFAULT_CSV_DIR);
  if (!years) years = detectYearsFromCsvDir(csvDir);

  for (const year of years) {
    const opts = buildYearOpts(year, args);
    if (!existsSync(opts.csvPath)) { console.warn(`[${year}] CSV no encontrado — saltando`); continue; }
    await retryYear(opts);
  }
}

async function cmdStatus(args) {
  let years = resolveYears(args);
  const progDir = resolve(args['progress-dir'] || DEFAULT_PROGRESS);
  const csvDir  = resolve(args['csv-dir']       || DEFAULT_CSV_DIR);
  if (!years) years = detectYearsFromCsvDir(csvDir).filter(y => existsSync(join(progDir, `${y}.json`)));

  if (!years.length) { console.log('No hay progreso registrado aún.'); return; }

  console.log('\n── Estado del pipeline ──────────────────────\n');
  for (const year of years) {
    const state  = await loadProgress(year, progDir);
    const counts = countByStatus(state);
    const bar    = progressBar(counts.done, counts.total);
    console.log(`  ${year}  ${bar}  ${counts.done}/${counts.total} done  ${counts.failed} failed  ${counts.pending + counts.downloading + counts.downloaded + counts.analyzing} pendiente`);
    if (counts.failed > 0) {
      const ids = getIdsByStatus(state, 'failed').slice(0, 5);
      console.log(`         ✗ fallidos: ${ids.join(', ')}${counts.failed > 5 ? ` (+${counts.failed - 5} más)` : ''}`);
    }
  }
  console.log();
}

async function cmdValidate(args) {
  let years = resolveYears(args);
  const csvDir  = resolve(args['csv-dir']      || DEFAULT_CSV_DIR);
  const progDir = resolve(args['progress-dir'] || DEFAULT_PROGRESS);
  const reportsDir = resolve('reports');

  if (!years) years = detectYearsFromCsvDir(csvDir).filter(y => existsSync(join(progDir, `${y}.json`)));
  if (!years.length) { console.log('Nada que validar.'); return; }

  await mkdir(reportsDir, { recursive: true });

  for (const year of years) {
    const opts   = buildYearOpts(year, args);
    if (!existsSync(opts.csvPath)) continue;

    const rows   = await readCsv(opts.csvPath);
    const state  = await loadProgress(year, progDir);
    const counts = countByStatus(state);

    // Contar skipped (ids con done pero marcados como skipped)
    const skipped = Object.values(state.ids).filter(v => v.status === 'done' && v.skippedAt).length;
    const failedIds = getIdsByStatus(state, 'failed');

    const report = {
      year:      Number(year),
      total:     rows.length,
      done:      counts.done,
      failed:    counts.failed,
      skipped,
      pending:   counts.pending + counts.downloading + counts.downloaded + counts.analyzing,
      failedIds,
      generatedAt: new Date().toISOString(),
    };

    const reportPath = join(reportsDir, `quality_${year}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`  [${year}] Reporte: ${reportPath}`);
    console.log(`         done: ${report.done}  failed: ${report.failed}  pending: ${report.pending}`);
    if (failedIds.length) console.log(`         fallidos: ${failedIds.join(', ')}`);
  }
}

// ─── Helper visual ────────────────────────────────────────────────────────────

function progressBar(done, total, width = 20) {
  if (!total) return '[' + ' '.repeat(width) + ']   0%';
  const pct  = done / total;
  const fill = Math.round(pct * width);
  return '[' + '█'.repeat(fill) + '░'.repeat(width - fill) + '] ' + String(Math.round(pct * 100)).padStart(3) + '%';
}

// ─── Dispatcher principal ─────────────────────────────────────────────────────

async function main() {
  const argv    = process.argv.slice(2);
  const command = argv[0];
  const args    = parseArgs(argv.slice(1));

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP); process.exit(0);
  }

  // Refrescar PATH para ffmpeg/yt-dlp instalados con winget (Windows)
  if (process.platform === 'win32') {
    const { execSync } = await import('node:child_process');
    try {
      const machine = execSync('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path', { encoding: 'utf8' });
      const user    = execSync('reg query "HKCU\\Environment" /v Path', { encoding: 'utf8' });
      const mPath   = (machine.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/)?.[1] || '').trim();
      const uPath   = (user.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/)?.[1] || '').trim();
      process.env.PATH = [mPath, uPath, process.env.PATH].filter(Boolean).join(';');
    } catch { /* no crítico */ }
  }

  try {
    switch (command) {
      case 'run':      await cmdRun(args, 'run');      break;
      case 'download': await cmdRun(args, 'download'); break;
      case 'analyze':  await cmdRun(args, 'analyze');  break;
      case 'retry':    await cmdRetry(args);            break;
      case 'status':   await cmdStatus(args);           break;
      case 'validate': await cmdValidate(args);         break;
      default:
        console.error(`Comando desconocido: "${command}"\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error('\n✗ Error fatal:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();
