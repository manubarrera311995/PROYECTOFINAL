/**
 * pipeline/download.js
 * Descarga de audio desde YouTube vía yt-dlp.
 *
 * Flujo: CSV fila (id, banda, cancion, year) → WAV en downloads/{year}/{id}.wav
 * Búsqueda: `ytsearch1:{banda} - {cancion}` (primer resultado de YouTube)
 * Log: título del video elegido + duración en segundos.
 */

import { spawn }    from 'node:child_process';
import { mkdir }    from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join }     from 'node:path';

// yt-dlp puede instalarse como binario o como módulo Python
const YTDLP_CMD = process.env.YTDLP_PATH || 'yt-dlp';

// Reintentos ante errores transitorios de YouTube
const DEFAULT_RETRIES    = 3;
const DEFAULT_RETRY_WAIT = 5; // segundos entre reintentos

// ─── Cookies (para videos age-restricted o con login requerido) ───────────────
// Prioridad: YTDLP_COOKIES_FILE > YTDLP_COOKIES_FROM_BROWSER > nada
// Ejemplos en .env:
//   YTDLP_COOKIES_FROM_BROWSER=chrome   (lee cookies de Chrome automáticamente)
//   YTDLP_COOKIES_FROM_BROWSER=firefox
//   YTDLP_COOKIES_FROM_BROWSER=edge
//   YTDLP_COOKIES_FILE=./cookies.txt    (archivo exportado manualmente)
function buildCookieArgs() {
  if (process.env.YTDLP_COOKIES_FILE) {
    return ['--cookies', process.env.YTDLP_COOKIES_FILE];
  }
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    return ['--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER];
  }
  return [];
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Lanza un proceso hijo y devuelve { stdout, stderr, code }.
 * No lanza error si el proceso falla — el llamador decide.
 */
function runProcess(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { ...opts, shell: false });
    let stdout = '', stderr = '';
    proc.stdout?.on('data', d => { stdout += d.toString(); });
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => resolve({ stdout, stderr, code }));
    proc.on('error', err  => resolve({ stdout, stderr: err.message, code: 1 }));
  });
}

/**
 * Resuelve el comando real de yt-dlp (binario o python -m yt_dlp).
 * Se cachea en memoria para no repetir la búsqueda en cada descarga.
 */
let _ytdlpResolved = null;
async function resolveYtdlp() {
  if (_ytdlpResolved) return _ytdlpResolved;

  // 1. Intentar binario configurado / en PATH
  const { code } = await runProcess(YTDLP_CMD, ['--version']);
  if (code === 0) { _ytdlpResolved = [YTDLP_CMD]; return _ytdlpResolved; }

  // 2. Fallback: python -m yt_dlp
  const { code: code2 } = await runProcess('python', ['-m', 'yt_dlp', '--version']);
  if (code2 === 0) { _ytdlpResolved = ['python', '-m', 'yt_dlp']; return _ytdlpResolved; }

  throw new Error(
    'yt-dlp no encontrado. Instálalo con: pip install yt-dlp  o descarga el binario desde https://github.com/yt-dlp/yt-dlp'
  );
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Descarga el audio de una canción del CSV a WAV.
 *
 * @param {object} params
 * @param {string} params.id        ID del CSV (ej. "DE_1")
 * @param {string} params.banda     Nombre del artista
 * @param {string} params.cancion   Nombre de la canción
 * @param {string|number} params.year  Año de la edición
 * @param {string} params.outputDir Carpeta raíz de descargas (ej. "downloads")
 * @param {number} [params.retries]     Número de reintentos (default 3)
 * @param {number} [params.retryWaitSec] Pausa entre reintentos en segundos (default 5)
 *
 * @returns {Promise<{
 *   wavPath:        string,   // ruta absoluta del WAV descargado
 *   videoTitle:     string,   // título del video elegido por yt-dlp
 *   durationSec:    number,   // duración en segundos
 *   searchQuery:    string,   // query usada para la búsqueda
 * }>}
 */
export async function downloadTrack({
  id,
  banda,
  cancion,
  year,
  outputDir,
  retries    = DEFAULT_RETRIES,
  retryWaitSec = DEFAULT_RETRY_WAIT,
}) {
  const [ytCmd, ...ytArgs] = await resolveYtdlp();

  // Carpeta de destino: downloads/{year}/
  const destDir = join(outputDir, String(year));
  await mkdir(destDir, { recursive: true });

  const wavPath = join(destDir, `${id}.wav`);

  // Construir query de búsqueda
  const searchQuery = `ytsearch1:${banda} - ${cancion}`;

  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (attempt > 1) {
      console.log(`  [download] Reintento ${attempt}/${retries} en ${retryWaitSec} s...`);
      await sleep(retryWaitSec * 1000);
    }

    try {
      const result = await doDownload({ ytCmd, ytArgs, searchQuery, wavPath, id });
      return { wavPath, searchQuery, ...result };
    } catch (err) {
      lastError = err;
      console.warn(`  [download] ${id} intento ${attempt} fallido: ${err.message}`);
    }
  }

  throw lastError;
}

// ─── Descarga interna ─────────────────────────────────────────────────────────

async function doDownload({ ytCmd, ytArgs, searchQuery, wavPath, id }) {
  const cookieArgs = buildCookieArgs();

  // Paso 1: obtener metadatos del video (título, duración) sin descargar
  const metaArgs = [
    ...ytArgs,
    ...cookieArgs,
    '--print', '%(title)s\n%(duration)s',
    '--no-playlist',
    '--default-search', 'ytsearch',
    '--no-warnings',
    searchQuery,
  ];

  const meta = await runProcess(ytCmd, metaArgs);
  if (meta.code !== 0) {
    throw new Error(`yt-dlp metadatos falló (${meta.code}): ${meta.stderr.trim().split('\n')[0]}`);
  }

  const [videoTitle = 'Desconocido', durationRaw = '0'] = meta.stdout.trim().split('\n');
  const durationSec = parseInt(durationRaw, 10) || 0;

  console.log(`  [download] "${id}" → "${videoTitle}" (${formatDuration(durationSec)})`);

  // Paso 2: descargar y convertir a WAV 16 kHz mono con ffmpeg embebido en yt-dlp
  const dlArgs = [
    ...ytArgs,
    ...cookieArgs,
    '--extract-audio',
    '--audio-format',    'wav',
    '--audio-quality',   '0',           // mejor calidad antes de convertir
    '--postprocessor-args', 'ffmpeg:-ac 1 -ar 16000',  // mono, 16 kHz
    '--output',          wavPath,
    '--no-playlist',
    '--default-search',  'ytsearch',
    '--no-warnings',
    '--quiet',
    searchQuery,
  ];

  const dl = await runProcess(ytCmd, dlArgs);

  // yt-dlp añade extensión .wav; verificar que el archivo exista
  const finalPath = existsSync(wavPath) ? wavPath : wavPath;
  if (!existsSync(finalPath) && dl.code !== 0) {
    throw new Error(`Descarga fallida (${dl.code}): ${dl.stderr.trim().split('\n')[0]}`);
  }
  if (!existsSync(finalPath)) {
    throw new Error(`WAV no encontrado tras descarga: ${finalPath}`);
  }

  return { videoTitle, durationSec };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function formatDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
