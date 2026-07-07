/**
 * core/calibration.js
 * Motor de calibración y heurísticas de mood
 *
 * Heurísticas de mood (DSP), calibración de scores Essentia con DSP,
 * cálculo de descriptores compuestos (engagement, nostalgia, oscuridad)
 * y construcción del objeto descriptor final compatible con el timeline.
 */

import { computeAcousticFeatures } from './dsp.js';

// ─── Mood heurístico (DSP puro) ───────────────────────────────────────────────

/**
 * Calcula scores de mood a partir de features acústicos usando heurísticas DSP.
 * Usado como fallback cuando Essentia no está disponible o da scores planos.
 *
 * @param {Float32Array} mono
 * @param {number} sr
 * @returns {{ happy, sad, relaxed, aggressive, danceable }}
 */
export function computeHeuristicMood(mono, sr) {
  const f = computeAcousticFeatures(mono, sr);
  const rms = f.rms_mean || 0;
  const zcr = f.zcr_mean || 0;
  const c   = f.centroid_mean || 0;
  const fl  = f.flatness_mean || 0;
  const tE  = (f.lowE_mean || 0) + (f.midE_mean || 0) + (f.highE_mean || 0) + 1e-10;
  const ch  = f.chroma_mean || new Array(12).fill(0);

  const n   = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const amp = (v, s = 2.5) => 1 / (1 + Math.exp(-s * (v * 2 - 1)));

  const ms = ((ch[0] || 0) + (ch[4] || 0) + (ch[7] || 0)) / 3
           - ((ch[9] || 0) + (ch[0] || 0) + (ch[4] || 0)) / 3;

  const happy_raw      = n(ms, -0.2, 0.4) * 0.45 + n(c, 1000, 5000) * 0.30 + n(zcr, 0.05, 0.25) * 0.25;
  const relaxed_raw    = (1 - n(rms, 0.01, 0.25)) * 0.50 + (1 - n(zcr, 0.02, 0.20)) * 0.30 + (1 - n(fl, 0, 0.4)) * 0.20;
  const aggressive_raw = n(rms, 0.08, 0.35) * 0.40 + n(zcr, 0.12, 0.35) * 0.30 + n((f.highE_mean || 0) / tE, 0.15, 0.55) * 0.30;
  const danceable_raw  = n((f.lowE_mean || 0) / tE, 0.15, 0.55) * 0.40 + n(rms, 0.03, 0.22) * 0.35 + (1 - n(fl, 0, 0.5)) * 0.25;

  const happy      = amp(happy_raw);
  const relaxed    = amp(relaxed_raw);
  const aggressive = amp(aggressive_raw);
  const danceable  = amp(danceable_raw);

  return { happy, sad: 1 - happy, relaxed, aggressive, danceable };
}

// ─── Calibración Essentia con DSP ─────────────────────────────────────────────

/**
 * Corrige scores extremos de Essentia usando features acústicos DSP.
 * Idéntica a la calibración del index.html (post runEssentiaModels).
 *
 * @param {{ happy, sad, relaxed, aggressive, danceable }} mood  Scores de Essentia
 * @param {object} acoustic  Objeto de computeAcousticFeatures
 * @returns {{ happy, sad, relaxed, aggressive, danceable }}
 */
export function calibrateMood(mood, acoustic) {
  const dspEnergy = Math.min(1, Math.max(0, (acoustic.rms_mean || 0) / 0.3));
  const dspZcr    = Math.min(1, Math.max(0, (acoustic.zcr_mean || 0) / 0.3));

  let { happy, sad, relaxed, aggressive, danceable } = mood;

  if (dspEnergy < 0.35 && aggressive > 0.45) {
    const correction = (0.35 - dspEnergy) * 3.0;
    aggressive = Math.max(0.05, aggressive - correction);
    relaxed    = Math.min(0.95, relaxed    + correction * 1.0);
  }

  if (dspEnergy > 0.7 && relaxed > 0.5) {
    const correction = (dspEnergy - 0.7) * 2.0;
    relaxed    = Math.max(0.05, relaxed    - correction);
    aggressive = Math.min(0.95, aggressive + correction * 0.6);
  }

  if (dspZcr < 0.08 && aggressive > 0.45) {
    const correction = (0.08 - dspZcr) * 3.0;
    aggressive = Math.max(0.05, aggressive - correction);
    relaxed    = Math.min(0.95, relaxed    + correction * 0.8);
  }

  return { happy, sad, relaxed, aggressive, danceable };
}

// ─── Descriptores compuestos (engagement, nostalgia, oscuridad) ───────────────

/**
 * Calcula engagement, approachability, nostalgia y oscuridad usando DSP puro.
 * En la web esto se llamaba classifyWithAI pero no llama a ninguna API.
 *
 * @param {object} acoustic  Objeto de computeAcousticFeatures
 * @param {{ happy, sad, relaxed, aggressive, danceable }} mood
 * @returns {{ engagement, approachability, nostalgia, oscuridad }}
 */
export function computeCompositeDescriptors(acoustic, mood) {
  const n = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

  const rms  = acoustic.rms_mean  || 0;
  const cent = acoustic.centroid_mean || 0;
  const flat = acoustic.flatness_mean || 0;
  const std  = acoustic.rms_std   || 0;
  const bpm  = acoustic.tempo_bpm || 90;
  const minor = (acoustic.scale === 'Menor') ? 1 : 0.4;

  const engagement = Math.round(
    (n(rms, 0.02, 0.35) * 0.35 + n(std, 0.01, 0.15) * 0.30 +
     n(cent, 500, 6000) * 0.20 + (mood.danceable || 0.5) * 0.15) * 100
  );

  const approachability = Math.round(
    ((1 - n(flat, 0, 0.6)) * 0.35 + (1 - n(cent, 3000, 9000)) * 0.25 +
     (mood.happy || 0.5) * 0.25 + (1 - n(rms, 0.2, 0.5)) * 0.15) * 100
  );

  // Nostalgia: tristeza suave + acústico + calma + baja energía
  const valence_  = mood.happy  || 0.5;
  const acoustic_ = 1 - n(flat, 0, 0.6);
  const energy_   = n(rms, 0, 0.35);

  const tempoNost = Math.exp(-Math.pow(bpm - 85, 2) / (2 * 15 * 15));
  const nostalgia_raw =
    0.28 * (1 - valence_)            +
    0.22 * acoustic_                  +
    0.20 * (mood.relaxed   || 0.5)   +
    0.15 * (1 - energy_)             +
    0.10 * tempoNost                  +
    0.05 * (1 - (mood.aggressive || 0.5));

  const nostalgia = Math.round(Math.min(100, Math.max(0,
    (1 / (1 + Math.exp(-6 * (nostalgia_raw - 0.42)))) * 100
  )));

  // Oscuridad: modo menor + tensión + timbre oscuro
  const oscuridad_raw =
    0.30 * minor                              +
    0.28 * (mood.aggressive || 0.5)          +
    0.22 * (1 - n(cent, 600, 7000))          +
    0.12 * (1 - valence_)                    +
    0.08 * (1 - acoustic_);

  const oscuridad = Math.round(Math.min(100, Math.max(0,
    (1 / (1 + Math.exp(-6 * (oscuridad_raw - 0.42)))) * 100
  )));

  return {
    engagement:      Math.min(100, Math.max(0, engagement)),
    approachability: Math.min(100, Math.max(0, approachability)),
    nostalgia,
    oscuridad,
  };
}

// ─── Descriptor final compatible con timeline ─────────────────────────────────

/**
 * Construye el objeto descriptor JSON-ready que se escribe en DATA_{year}/{id}.json.
 * Compatible con el formato del timeline emocional.
 *
 * @param {object} acoustic    Resultado de computeAcousticFeatures
 * @param {{ happy, sad, relaxed, aggressive, danceable }} mood
 * @param {{ engagement, approachability, nostalgia, oscuridad }} composite
 * @param {string} moodSource  'Essentia MTG ML' | 'DSP heurístico'
 * @returns {object}
 */
export function buildDescriptors(acoustic, mood, composite, moodSource) {
  const pct = v => Math.round(Math.min(100, Math.max(0, (v || 0) * 100)));

  const happy      = pct(mood.happy);
  const danceability = pct(mood.danceable);
  const energy     = Math.round(Math.min(100, Math.max(0, (acoustic.rms_mean || 0) / 0.3 * 100)));
  const tempo      = Math.round(Math.min(200, Math.max(60, 60 + (acoustic.zcr_mean || 0) * 800)));

  return {
    // Moods principales
    danceability,
    happy,
    sad:        Math.round(100 - happy),
    relaxed:    pct(mood.relaxed),
    aggressive: pct(mood.aggressive),

    // Descriptores compuestos (DSP)
    engagement:      composite.engagement,
    approachability: composite.approachability,
    nostalgia:       composite.nostalgia,
    oscuridad:       composite.oscuridad,

    // Energía y tempo
    energy,
    tempo,

    // Spotify (vacíos por defecto; se rellenan con enriquecimiento Spotify)
    instrumentalness: null,
    liveness:         null,
    speechiness:      null,

    // Features espectrales
    keyNote:          acoustic.keyNote     || '?',
    scale:            acoustic.scale       || '?',
    loudness_db:      acoustic.loudness_db || 0,
    spectralCentroid: Math.round(acoustic.centroid_mean || 0),
    spectralRolloff:  Math.round(acoustic.rolloff_mean  || 0),
    spectralFlatness: Math.round((acoustic.flatness_mean || 0) * 100),
    zeroCrossingRate: Math.round((acoustic.zcr_mean     || 0) * 10000) / 100,
    lowFreqRatio:     acoustic.lowFreqRatio  || 0,
    midFreqRatio:     acoustic.midFreqRatio  || 0,
    highFreqRatio:    acoustic.highFreqRatio || 0,

    // Género (vacío por defecto; se rellena con enriquecimiento Spotify)
    genre:    '',
    subgenre: '',

    // Metadata Spotify (vacía por defecto)
    spotifyTrackName:       null,
    spotifyArtist:          null,
    spotifyAlbumArt:        null,
    spotifyGenres:          [],
    spotifyMatchConfidence: 0,

    // Trazabilidad
    moodSource: moodSource || 'DSP heurístico',
  };
}
