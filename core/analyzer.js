/**
 * Punto de entrada del análisis emocional.
 * Fase 2 — analyzeBuffer(pcm, sampleRate) → descriptores compatibles con timeline
 */

/**
 * @param {Float32Array} pcm - Audio PCM mono
 * @param {number} sampleRate - Típicamente 16000
 * @returns {Promise<object>} Descriptores emocionales y acústicos
 */
export async function analyzeBuffer(pcm, sampleRate = 16000) {
  throw new Error(
    `analyzeBuffer aún no implementado (Fase 2). Recibido: ${pcm.length} muestras @ ${sampleRate} Hz`
  );
}
