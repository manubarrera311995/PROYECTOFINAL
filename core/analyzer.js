/**
 * core/analyzer.js
 * Fase 2 — Punto de entrada del análisis emocional batch.
 *
 * analyzeBuffer(pcm, sampleRate) → descriptores compatibles con el timeline.
 *
 * Recibe PCM ya decodificado (Float32Array, 16 kHz mono), sin AudioContext.
 * Modelos Essentia se cargan la primera vez (lazy singleton) y se reutilizan.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync }    from 'node:fs';
import * as tf           from '@tensorflow/tfjs-node';

import {
  computeAcousticFeatures,
  computePseudoEmbeddings,
  computeMelPatches,
} from './dsp.js';

import {
  computeHeuristicMood,
  calibrateMood,
  computeCompositeDescriptors,
  buildDescriptors,
} from './calibration.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'models');

// ─── Definición de modelos Essentia ──────────────────────────────────────────

const MODEL_SPECS = [
  { key: 'happy',      folder: 'mood_happy-musicnn'      },
  { key: 'relaxed',    folder: 'mood_relaxed-musicnn'    },
  { key: 'aggressive', folder: 'mood_aggressive-musicnn' },
  { key: 'danceable',  folder: 'danceability-musicnn'    },
];

// ─── Singleton de modelos ─────────────────────────────────────────────────────

/** @type {Map<string, tf.GraphModel> | null} */
let _models = null;
let _modelsLoading = false;
let _modelsLoadPromise = null;

/**
 * Carga los modelos Essentia la primera vez y los reutiliza.
 * Thread-safe: si se llama en paralelo, espera la misma promesa.
 * Si los modelos no están disponibles, devuelve null (usará DSP heurístico).
 *
 * @returns {Promise<Map<string, tf.GraphModel> | null>}
 */
async function getModels() {
  if (_models !== null) return _models;
  if (_modelsLoadPromise) return _modelsLoadPromise;

  _modelsLoadPromise = (async () => {
    if (!existsSync(MODELS_DIR)) {
      console.warn('[analyzer] models/ no encontrado — usando DSP heurístico');
      return null;
    }

    const map = new Map();
    for (const { key, folder } of MODEL_SPECS) {
      const modelPath = join(MODELS_DIR, folder, 'model.json');
      if (!existsSync(modelPath)) {
        console.warn(`[analyzer] Modelo ${folder} no encontrado — se omitirá`);
        continue;
      }
      const url = `file://${modelPath.replace(/\\/g, '/')}`;
      try {
        map.set(key, await tf.loadGraphModel(url));
      } catch (err) {
        console.warn(`[analyzer] Error cargando ${folder}:`, err.message);
      }
    }

    _models = map.size > 0 ? map : null;
    if (_models) {
      console.log(`[analyzer] Modelos cargados: ${[...map.keys()].join(', ')}`);
    } else {
      console.warn('[analyzer] Ningún modelo cargado — usando DSP heurístico');
    }
    return _models;
  })();

  return _modelsLoadPromise;
}

// ─── Inferencia Essentia ──────────────────────────────────────────────────────

/**
 * Ejecuta los modelos Essentia con pseudo-embeddings de 200 dims.
 * Devuelve null si los modelos no están listos o dan scores planos.
 *
 * @param {Float32Array} embeddings  Vector 200-dim
 * @param {Map<string, tf.GraphModel>} models
 * @returns {Promise<{ happy, sad, relaxed, aggressive, danceable } | null>}
 */
async function runEssentiaModels(embeddings, models) {
  if (!models || !embeddings || embeddings.length < 200) return null;

  const tensor        = tf.tensor2d(embeddings, [1, 200]);
  const learningPhase = tf.scalar(false);
  const scores        = { happy: null, relaxed: null, aggressive: null, danceable: null };

  for (const [name, model] of models.entries()) {
    try {
      let out;
      try { out = model.predict([tensor, learningPhase]); }
      catch { out = model.predict(tensor); }
      const data = await out.data();
      out.dispose();
      scores[name] = data.length >= 2 ? data[1] : data[0];
    } catch (err) {
      console.warn(`[analyzer] predict(${name}):`, err.message);
    }
  }

  learningPhase.dispose();
  tensor.dispose();

  const valid = Object.values(scores).filter(v => v !== null);
  if (valid.length === 0) return null;

  // Si todos los scores son muy planos (sin discriminación), preferir DSP
  const isFlat = Object.values(scores)
    .filter(v => typeof v === 'number')
    .every(v => Math.abs(v - 0.5) < 0.08);
  if (isFlat) return null;

  for (const k of Object.keys(scores)) if (scores[k] === null) scores[k] = 0.5;
  scores.sad = 1 - (scores.happy || 0.5);

  return scores;
}

// ─── Segmentación del PCM ─────────────────────────────────────────────────────

/**
 * Replica la estrategia del Worker web: toma 3 segmentos de 8 s
 * (inicio, centro, final) y los concatena para el análisis DSP.
 * Si el audio es más corto que 3 × 8 s, usa el buffer completo.
 *
 * @param {Float32Array} mono
 * @param {number} sr
 * @returns {Float32Array}
 */
function sampleAudio(mono, sr) {
  const sampleLen = sr * 8;
  if (mono.length <= sampleLen * 3) return mono;

  const mid = Math.floor(mono.length / 2);
  const segments = [
    mono.slice(0, sampleLen),
    mono.slice(mid - Math.floor(sampleLen / 2), mid + Math.floor(sampleLen / 2)),
    mono.slice(mono.length - sampleLen),
  ];

  const total  = segments.reduce((s, a) => s + a.length, 0);
  const sample = new Float32Array(total);
  let offset = 0;
  for (const seg of segments) { sample.set(seg, offset); offset += seg.length; }
  return sample;
}

// ─── Punto de entrada público ─────────────────────────────────────────────────

/**
 * Analiza un buffer PCM y devuelve descriptores compatibles con el timeline.
 *
 * @param {Float32Array} pcm        Audio PCM 16 kHz mono (ya decodificado por ffmpeg)
 * @param {number}       sampleRate Sample rate del PCM (típicamente 16000)
 * @returns {Promise<object>}       Objeto listo para serializar como JSON
 */
export async function analyzeBuffer(pcm, sampleRate = 16000) {
  // 1. Segmentación (3 × 8 s, igual que el Worker)
  const sample = sampleAudio(pcm, sampleRate);

  // 2. Features acústicos DSP
  const acoustic = computeAcousticFeatures(sample, sampleRate);
  acoustic.duration   = pcm.length / sampleRate;
  acoustic.sampleRate = sampleRate;

  // 3. Pseudo-embeddings y mel patches (entrada a Essentia)
  const embeddings = computePseudoEmbeddings(sample, sampleRate);
  const melPatches = computeMelPatches(sample, sampleRate);  // eslint-disable-line no-unused-vars

  // 4. Mood heurístico DSP (fallback)
  const hMood = computeHeuristicMood(sample, sampleRate);

  // 5. Modelos Essentia (lazy singleton)
  const models         = await getModels();
  const essentiaScores = await runEssentiaModels(embeddings, models);

  // 6. Elegir fuente de mood + calibrar si viene de Essentia
  let mood, moodSource;
  if (essentiaScores) {
    mood       = calibrateMood(essentiaScores, acoustic);
    moodSource = 'Essentia MTG ML';
  } else {
    mood       = hMood;
    moodSource = 'DSP heurístico';
  }

  // 7. Descriptores compuestos (engagement, nostalgia, oscuridad)
  const composite = computeCompositeDescriptors(acoustic, mood);

  // 8. Objeto descriptor final
  const descriptors = buildDescriptors(acoustic, mood, composite, moodSource);

  // Añadir duración y sampleRate al descriptor (campos del timeline)
  descriptors.duration   = acoustic.duration;
  descriptors.sampleRate = acoustic.sampleRate;
  descriptors.channels   = 1;

  return descriptors;
}
