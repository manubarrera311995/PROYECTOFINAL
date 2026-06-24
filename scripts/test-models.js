#!/usr/bin/env node
/**
 * Fase 1 — Verificar carga de modelos Essentia con @tensorflow/tfjs-node
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs-node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'models');

const MODELS = [
  { key: 'happy', folder: 'mood_happy-musicnn' },
  { key: 'relaxed', folder: 'mood_relaxed-musicnn' },
  { key: 'aggressive', folder: 'mood_aggressive-musicnn' },
  { key: 'danceable', folder: 'danceability-musicnn' },
];

/** Tensor dummy: batch 1, mel bins 96, frames 187 (forma típica MusicNN) */
function dummyInput() {
  return tf.zeros([1, 187, 96]);
}

async function loadAndInfer({ key, folder }) {
  const modelPath = join(MODELS_DIR, folder, 'model.json');
  if (!existsSync(modelPath)) {
    throw new Error(`No existe ${modelPath}. Ejecuta: npm run setup:models`);
  }

  const url = `file://${modelPath.replace(/\\/g, '/')}`;
  const model = await tf.loadGraphModel(url);

  const input = dummyInput();
  const output = model.predict(input);
  const tensors = Array.isArray(output) ? output : [output];
  const shapes = tensors.map((t) => t.shape.join('×'));
  tensors.forEach((t) => t.dispose());
  input.dispose();
  model.dispose();

  return shapes;
}

async function main() {
  console.log('Validando modelos Essentia (Fase 1)...\n');

  if (!existsSync(MODELS_DIR)) {
    console.error('Carpeta models/ no encontrada. Ejecuta primero: npm run setup:models\n');
    process.exit(1);
  }

  let ok = 0;
  for (const spec of MODELS) {
    process.stdout.write(`  ${spec.folder} ... `);
    try {
      const shapes = await loadAndInfer(spec);
      console.log(`OK (salida: ${shapes.join(', ')})`);
      ok++;
    } catch (err) {
      console.log('FALLÓ');
      console.error(`    ${err.message}`);
    }
  }

  console.log(`\n${ok}/${MODELS.length} modelos cargados correctamente.`);

  if (ok < MODELS.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
