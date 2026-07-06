/**
 * pipeline/analyze.js
 * WAV → PCM (ffmpeg) → analyzeBuffer (core/) → {id}.json
 *
 * Flujo:
 *   wavPath → ffmpeg pipe → Float32Array 16 kHz mono
 *           → analyzeBuffer → descriptores
 *           → merge metadata CSV → escribir JSON
 */

import { spawn }     from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync }       from 'node:fs';
import { dirname }          from 'node:path';
import { analyzeBuffer }    from '../core/analyzer.js';

const FFMPEG_CMD = process.env.FFMPEG_PATH || 'ffmpeg';
const TARGET_SR  = 16000;

// ─── Decodificación WAV → PCM ─────────────────────────────────────────────────

/**
 * Decodifica un archivo de audio a PCM Float32 16 kHz mono usando ffmpeg.
 * Usa pipe stdout para no escribir archivos temporales en disco.
 *
 * @param {string} audioPath  Ruta al WAV (o cualquier formato soportado por ffmpeg)
 * @returns {Promise<Float32Array>}  Muestras PCM normalizadas [-1, 1]
 */
export async function decodeAudioToPcm(audioPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i',      audioPath,
      '-f',      'f32le',      // output: float 32-bit little-endian raw PCM
      '-ac',     '1',          // mono
      '-ar',     String(TARGET_SR),
      '-vn',                   // sin video
      'pipe:1',                // escribir a stdout
    ];

    const proc  = spawn(FFMPEG_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let   stderr = '';

    proc.stdout.on('data', chunk => chunks.push(chunk));
    proc.stderr.on('data', d    => { stderr += d.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        const msg = stderr.split('\n').filter(l => l.includes('Error') || l.includes('error') || l.includes('Invalid')).join(' ') || stderr.slice(-200);
        return reject(new Error(`ffmpeg salió con código ${code}: ${msg.trim()}`));
      }
      if (chunks.length === 0) {
        return reject(new Error('ffmpeg no produjo PCM — archivo vacío o inválido'));
      }

      // Concatenar chunks y convertir a Float32Array
      const total  = chunks.reduce((s, c) => s + c.length, 0);
      const buf    = Buffer.concat(chunks, total);
      const pcm    = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

      // Copia defensiva (el Buffer subyacente puede ser GC'd)
      resolve(new Float32Array(pcm));
    });

    proc.on('error', err => reject(new Error(`No se pudo lanzar ffmpeg: ${err.message}. Asegúrate de que ffmpeg esté instalado.`)));
  });
}

// ─── Derivar filename ─────────────────────────────────────────────────────────

/**
 * Genera el campo `filename` del JSON a partir de los metadatos del CSV.
 * Ejemplo: "Diamante Eléctrico - Telescopio"
 */
function deriveFilename(banda, cancion) {
  return `${banda} - ${cancion}`;
}

// ─── API principal ────────────────────────────────────────────────────────────

/**
 * Analiza un WAV y escribe el JSON de descriptores.
 *
 * @param {object} params
 * @param {string}  params.wavPath     Ruta al WAV descargado
 * @param {string}  params.outputPath  Ruta de salida del JSON (ej. DATA_2013/DE_3.json)
 * @param {object}  [params.metadata]  Campos del CSV: { id, banda, cancion, ... }
 *
 * @returns {Promise<object>}  El objeto descriptor escrito al disco
 */
export async function analyzeWav({ wavPath, outputPath, metadata = {} }) {
  if (!existsSync(wavPath)) {
    throw new Error(`WAV no encontrado: ${wavPath}`);
  }

  // 1. Decodificar WAV → PCM Float32 16 kHz mono
  const pcm = await decodeAudioToPcm(wavPath);

  if (pcm.length < TARGET_SR * 2) {
    throw new Error(`Audio demasiado corto (${(pcm.length / TARGET_SR).toFixed(1)} s) — mínimo 2 s`);
  }

  // 2. Análisis emocional y acústico
  const descriptors = await analyzeBuffer(pcm, TARGET_SR);

  // 3. Enriquecer con metadata del CSV
  const { banda = '', cancion = '' } = metadata;

  descriptors.filename         = deriveFilename(banda, cancion);
  descriptors.spotifyTrackName = cancion  || null;
  descriptors.spotifyArtist    = banda    || null;
  // Campos Spotify vacíos (se rellenan con enriquecimiento Spotify)
  descriptors.spotifyAlbumArt        = null;
  descriptors.spotifyGenres          = [];
  descriptors.spotifyMatchConfidence = 0;
  // Género vacío (se rellena con enriquecimiento Spotify)
  descriptors.genre            = '';
  descriptors.subgenre         = '';
  descriptors.genreExplanation = '';
  descriptors.genreConfidence  = 0;

  // 4. Asegurar carpeta de salida y escribir JSON
  await mkdir(dirname(outputPath), { recursive: true });

  // Formato: array de un elemento — compatible con el timeline de audio-dna
  const json = JSON.stringify([descriptors], null, 2);
  await writeFile(outputPath, json, 'utf8');

  return descriptors;
}
