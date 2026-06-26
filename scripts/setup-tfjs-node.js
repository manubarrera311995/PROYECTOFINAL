#!/usr/bin/env node
/**
 * Post-instalación de @tensorflow/tfjs-node en Windows.
 * npm install no siempre deja tensorflow.dll junto a tfjs_binding.node.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TFJS_NODE = join(ROOT, 'node_modules', '@tensorflow', 'tfjs-node');
const BINDING_DIR = join(TFJS_NODE, 'lib', 'napi-v8');
const BINDING = join(BINDING_DIR, 'tfjs_binding.node');
const DLL_SRC = join(TFJS_NODE, 'deps', 'lib', 'tensorflow.dll');
const DLL_DST = join(BINDING_DIR, 'tensorflow.dll');

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function ensureDll() {
  if (existsSync(DLL_DST)) return;
  if (!existsSync(DLL_SRC)) {
    console.log('setup-tfjs-node: descargando libtensorflow...');
    run('node scripts/install.js cpu download', TFJS_NODE);
  }
  if (existsSync(DLL_SRC)) {
    copyFileSync(DLL_SRC, DLL_DST);
    console.log('setup-tfjs-node: tensorflow.dll copiado a lib/napi-v8/');
  }
}

function ensureBinding() {
  if (existsSync(BINDING)) return;
  console.log('setup-tfjs-node: compilando bindings nativos...');
  run('npx node-pre-gyp install --fallback-to-build', TFJS_NODE);
}

async function verify() {
  await import('@tensorflow/tfjs-node');
}

async function main() {
  if (!existsSync(TFJS_NODE)) return;

  if (platform() === 'win32') {
    ensureBinding();
    ensureDll();
  }

  try {
    await verify();
    console.log('setup-tfjs-node: OK');
  } catch (err) {
    if (platform() === 'win32') {
      ensureBinding();
      ensureDll();
      await verify();
      console.log('setup-tfjs-node: OK (tras reparación)');
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('setup-tfjs-node: FALLÓ —', err.message);
  console.error('En Windows: instala Visual C++ Redistributable 2015–2022 (x64).');
  process.exit(1);
});
