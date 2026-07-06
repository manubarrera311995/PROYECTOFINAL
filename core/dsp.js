/**
 * core/dsp.js
 * Port del Web Worker de audio-dna/index.html
 *
 * Funciones puras de procesamiento de señal: FFT, banco de filtros Mel,
 * features por frame y agregación estadística.
 * Sin dependencias de DOM, AudioContext ni window.
 */

// ─── Escala Mel ───────────────────────────────────────────────────────────────

export const hz2mel = hz => 2595 * Math.log10(1 + hz / 700);
export const mel2hz = mel => 700 * (Math.pow(10, mel / 2595) - 1);

// ─── Ventana de Hann ──────────────────────────────────────────────────────────

export function hannWin(frame) {
  const n = frame.length;
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = frame[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / n));
  return o;
}

// ─── FFT (Cooley-Tukey in-place) ─────────────────────────────────────────────

export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let l = 2; l <= n; l <<= 1) {
    const a = -2 * Math.PI / l;
    const wR = Math.cos(a), wI = Math.sin(a);
    for (let i = 0; i < n; i += l) {
      let cR = 1, cI = 0;
      for (let j = 0; j < l / 2; j++) {
        const uR = re[i + j], uI = im[i + j];
        const vR = re[i + j + l / 2] * cR - im[i + j + l / 2] * cI;
        const vI = re[i + j + l / 2] * cI + im[i + j + l / 2] * cR;
        re[i + j] = uR + vR; im[i + j] = uI + vI;
        re[i + j + l / 2] = uR - vR; im[i + j + l / 2] = uI - vI;
        const nr = cR * wR - cI * wI; cI = cR * wI + cI * wR; cR = nr;
      }
    }
  }
}

/** Magnitud espectral (mitad positiva) de una señal real */
export function fftMag(sig) {
  const n = sig.length;
  const re = Array.from(sig);
  const im = new Array(n).fill(0);
  fft(re, im);
  const m = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) m[i] = Math.sqrt(re[i] ** 2 + im[i] ** 2);
  return m;
}

// ─── Banco de filtros Mel ─────────────────────────────────────────────────────

/**
 * @param {number} nMels  Número de filtros (96 para pseudo-embeddings, etc.)
 * @param {number} fSize  Tamaño del frame FFT
 * @param {number} sr     Sample rate
 * @returns {Array<number[]>} nMels arrays de pesos, uno por bin FFT
 */
export function buildMelFilters(nMels, fSize, sr) {
  const fMin = 0, fMax = sr / 2;
  const mMin = hz2mel(fMin), mMax = hz2mel(fMax);
  const pts = Array.from({ length: nMels + 2 }, (_, i) =>
    mel2hz(mMin + (mMax - mMin) * i / (nMels + 1))
  );
  const fRes = sr / (fSize * 2);
  const nBins = fSize / 2;
  return pts.slice(0, nMels).map((_, m) => {
    const f = new Array(nBins).fill(0);
    for (let k = 0; k < nBins; k++) {
      const freq = k * fRes;
      if (freq >= pts[m] && freq <= pts[m + 1])
        f[k] = (freq - pts[m]) / (pts[m + 1] - pts[m]);
      else if (freq > pts[m + 1] && freq <= pts[m + 2])
        f[k] = (pts[m + 2] - freq) / (pts[m + 2] - pts[m + 1]);
    }
    return f;
  });
}

// ─── Chroma ───────────────────────────────────────────────────────────────────

export function computeChroma(spec, sr, fRes) {
  const c = new Array(12).fill(0);
  for (let k = 1; k < spec.length; k++) {
    const f = k * fRes;
    if (f < 20 || f > 8000) continue;
    const pc = (((Math.round(12 * Math.log2(f / 440) + 69)) % 12) + 12) % 12;
    c[pc] += spec[k];
  }
  const mx = Math.max(...c);
  return mx > 0 ? c.map(v => v / mx) : c;
}

// ─── Features por frame ───────────────────────────────────────────────────────

export function frameFeats(frame, sr) {
  const n = frame.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += frame[i] ** 2;
  rms = Math.sqrt(rms / n);

  let zcr = 0;
  for (let i = 1; i < n; i++) if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) zcr++;
  zcr /= (n - 1);

  const spec = fftMag(hannWin(frame));
  const fRes = sr / n;

  let wS = 0, tM = 0;
  for (let k = 1; k < spec.length; k++) { wS += k * fRes * spec[k]; tM += spec[k]; }
  const centroid = tM > 0 ? wS / tM : 0;

  let cum = 0, rolloff = 0;
  const tgt = tM * 0.85;
  for (let k = 0; k < spec.length; k++) { cum += spec[k]; if (cum >= tgt) { rolloff = k * fRes; break; } }

  let gm = 0, am = 0;
  for (let k = 1; k < spec.length; k++) { gm += Math.log(spec[k] + 1e-10); am += spec[k]; }
  const flatness = am > 0 ? Math.exp(gm / (spec.length - 1)) / (am / (spec.length - 1)) : 0;

  const lE = Math.floor(300 / fRes), mE = Math.floor(2000 / fRes);
  let lowE = 0, midE = 0, highE = 0;
  for (let k = 0; k < spec.length; k++) {
    if (k < lE) lowE += spec[k];
    else if (k < mE) midE += spec[k];
    else highE += spec[k];
  }

  const chroma = computeChroma(spec, sr, fRes);
  return { rms, zcr, centroid, rolloff, flatness, lowE, midE, highE, chroma };
}

// ─── Agregación estadística ───────────────────────────────────────────────────

export function aggregate(frames) {
  if (!frames.length) return {};
  const keys = ['rms', 'zcr', 'centroid', 'rolloff', 'flatness', 'lowE', 'midE', 'highE'];
  const out = {};
  keys.forEach(k => {
    const v = frames.map(f => f[k]);
    out[`${k}_mean`] = v.reduce((a, b) => a + b, 0) / v.length;
    out[`${k}_std`]  = Math.sqrt(v.reduce((a, b) => a + (b - out[`${k}_mean`]) ** 2, 0) / v.length);
    out[`${k}_max`]  = Math.max(...v);
  });

  out.chroma_mean = frames[0].chroma.map((_, i) =>
    frames.reduce((s, f) => s + f.chroma[i], 0) / frames.length
  );

  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const mx = out.chroma_mean.indexOf(Math.max(...out.chroma_mean));
  out.keyNote = notes[mx];

  const maj = (out.chroma_mean[0] + out.chroma_mean[4] + out.chroma_mean[7]) / 3;
  const min = (out.chroma_mean[9] + out.chroma_mean[0] + out.chroma_mean[4]) / 3;
  out.modeScore = maj - min;
  out.scale = out.modeScore >= 0 ? 'Mayor' : 'Menor';

  out.loudness_db = out.rms_mean > 0
    ? Math.round(20 * Math.log10(out.rms_mean + 1e-10))
    : -60;

  const tE = (out.lowE_mean || 0) + (out.midE_mean || 0) + (out.highE_mean || 0) + 1e-10;
  out.lowFreqRatio  = Math.round(out.lowE_mean  / tE * 100);
  out.midFreqRatio  = Math.round(out.midE_mean  / tE * 100);
  out.highFreqRatio = Math.round(out.highE_mean / tE * 100);

  return out;
}

// ─── Acoustic features (nivel canción) ───────────────────────────────────────

/**
 * Extrae features acústicos estadísticos de un buffer PCM.
 * Usa fSize=2048, hop=1024, hasta 150 frames (como el Worker).
 */
export function computeAcousticFeatures(mono, sr) {
  const fSize = 2048, hop = 1024, maxF = 150;
  const frames = [];
  for (let s = 0, fi = 0; s + fSize <= mono.length && fi < maxF; s += hop, fi++)
    frames.push(mono.slice(s, s + fSize));
  return aggregate(frames.map(f => frameFeats(f, sr)));
}

// ─── Pseudo-embeddings MusiCNN (200-dim) ─────────────────────────────────────

/**
 * Genera vector de 200 features que aproxima embeddings MusiCNN.
 * Layout: [0-47] mel mean (primera mitad), [48-95] mel mean (segunda mitad),
 *         [96-143] mel delta (primera), [144-191] mel delta (segunda),
 *         [192-199] features globales discriminativas.
 */
export function computePseudoEmbeddings(mono, sr) {
  const fSize = 512, hop = 256, nMels = 96, maxFrames = 200;
  const frames = [];
  for (let s = 0, fi = 0; s + fSize <= mono.length && fi < maxFrames; s += hop, fi++)
    frames.push(mono.slice(s, s + fSize));
  if (!frames.length) return new Float32Array(200);

  const melFilters = buildMelFilters(nMels, fSize, sr);
  const melAcc = new Float32Array(nMels);
  const melVar = new Float32Array(nMels);
  let rmsSum = 0, zcrSum = 0, centSum = 0, flatSum = 0;
  let lowSum = 0, midSum = 0, highSum = 0, rmsMax = 0;

  frames.forEach(frame => {
    const spec = fftMag(hannWin(frame));
    const fRes = sr / fSize;

    let rms = 0;
    for (let i = 0; i < frame.length; i++) rms += frame[i] ** 2;
    rms = Math.sqrt(rms / frame.length);
    rmsSum += rms;
    if (rms > rmsMax) rmsMax = rms;

    let zcr = 0;
    for (let i = 1; i < frame.length; i++) if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) zcr++;
    zcrSum += zcr / (frame.length - 1);

    let wS = 0, tM = 0;
    for (let k = 1; k < spec.length; k++) { wS += k * fRes * spec[k]; tM += spec[k]; }
    centSum += tM > 0 ? wS / tM : 0;

    let gm = 0, am = 0;
    for (let k = 1; k < spec.length; k++) { gm += Math.log(spec[k] + 1e-10); am += spec[k]; }
    flatSum += am > 0 ? Math.exp(gm / (spec.length - 1)) / (am / (spec.length - 1)) : 0;

    const lBin = Math.floor(250 / fRes), mBin = Math.floor(2000 / fRes), hBin = Math.floor(6000 / fRes);
    let lE = 0, mE = 0, hE = 0;
    for (let k = 0; k < spec.length; k++) {
      if (k < lBin) lE += spec[k];
      else if (k < mBin) mE += spec[k];
      else if (k < hBin) hE += spec[k];
    }
    lowSum += lE; midSum += mE; highSum += hE;

    for (let m = 0; m < nMels; m++) {
      let e = 0;
      for (let k = 0; k < melFilters[m].length; k++) e += melFilters[m][k] * (spec[k] || 0);
      const logE = Math.log(e + 1e-8);
      melAcc[m] += logE;
      melVar[m] += logE * logE;
    }
  });

  const n = frames.length;
  const rms  = rmsSum  / n, zcr  = zcrSum  / n;
  const cent = centSum / n, flat = flatSum / n;
  const tE   = lowSum + midSum + highSum + 1e-10;
  const lowR = lowSum / tE, midR = midSum / tE, highR = highSum / tE;

  const melMean  = new Float32Array(nMels);
  const melDelta = new Float32Array(nMels);
  for (let m = 0; m < nMels; m++) {
    melMean[m]  = melAcc[m] / n;
    melDelta[m] = Math.sqrt(Math.max(0, melVar[m] / n - melMean[m] ** 2));
  }

  const melMin   = Math.min(...melMean),   melMax   = Math.max(...melMean)   + 1e-8;
  const deltaMin = Math.min(...melDelta), deltaMax = Math.max(...melDelta) + 1e-8;
  const norm = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

  const out = new Float32Array(200);
  for (let m = 0; m < 48; m++) out[m]       = (melMean[m]      - melMin)   / (melMax   - melMin);
  for (let m = 0; m < 48; m++) out[48 + m]  = (melMean[48 + m] - melMin)   / (melMax   - melMin);
  for (let m = 0; m < 48; m++) out[96 + m]  = (melDelta[m]      - deltaMin) / (deltaMax - deltaMin);
  for (let m = 0; m < 48; m++) out[144 + m] = (melDelta[48 + m] - deltaMin) / (deltaMax - deltaMin);

  out[192] = norm(rms,  0,    0.4);
  out[193] = norm(zcr,  0,    0.35);
  out[194] = norm(cent, 200,  8000);
  out[195] = norm(flat, 0,    0.7);
  out[196] = lowR;
  out[197] = midR;
  out[198] = highR;
  out[199] = norm(rmsMax, 0, 0.6);

  return out;
}

// ─── Mel patches (para modelos que aceptan [patchSize × nMels]) ──────────────

/**
 * Genera patches de espectrograma Mel para modelos Essentia que esperan
 * tensores [B, patchSize, nMels, 1].
 * Si el audio es demasiado corto, devuelve [].
 */
export function computeMelPatches(mono, sr) {
  const fSize = 512, hop = 256, nMels = 96, patchSize = 187, patchHop = 43;
  if (mono.length < fSize) return [];

  const melFilters = buildMelFilters(nMels, fSize, sr);
  const allFrames = [];
  for (let s = 0; s + fSize <= mono.length; s += hop) {
    const frame = mono.slice(s, s + fSize);
    const spec  = fftMag(hannWin(frame));
    const mel   = new Float32Array(nMels);
    for (let m = 0; m < nMels; m++) {
      let e = 0;
      for (let k = 0; k < melFilters[m].length; k++) e += melFilters[m][k] * (spec[k] || 0);
      mel[m] = Math.log(e + 1e-8);
    }
    allFrames.push(mel);
  }

  if (allFrames.length < patchSize) return [];

  const patches = [];
  for (let i = 0; i + patchSize <= allFrames.length; i += patchHop) {
    const patch = new Float32Array(patchSize * nMels);
    for (let f = 0; f < patchSize; f++) patch.set(allFrames[i + f], f * nMels);
    patches.push(patch);
  }
  return patches;
}
