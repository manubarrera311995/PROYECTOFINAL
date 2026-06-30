/**
 * pipeline/progress.js
 * Fase 5 — Gestión de estado persistente en progress/{year}.json
 *
 * Estados por canción:
 *   pending → downloading → downloaded → analyzing → done
 *                                                   → failed
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync }                 from 'node:fs';
import { join }                       from 'node:path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function progressPath(year, progressDir) {
  return join(progressDir, `${year}.json`);
}

// ─── Carga / creación ─────────────────────────────────────────────────────────

/**
 * Carga el archivo de progreso para un año.
 * Si no existe, devuelve un estado vacío.
 *
 * @param {string|number} year
 * @param {string}        progressDir
 * @returns {Promise<object>}  { year, updatedAt, ids: {} }
 */
export async function loadProgress(year, progressDir) {
  const path = progressPath(year, progressDir);
  if (!existsSync(path)) {
    return { year: Number(year), updatedAt: new Date().toISOString(), ids: {} };
  }
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    console.warn(`[progress] No se pudo leer ${path} — iniciando desde cero`);
    return { year: Number(year), updatedAt: new Date().toISOString(), ids: {} };
  }
}

// ─── Persistencia ─────────────────────────────────────────────────────────────

/**
 * Guarda el estado de progreso en disco.
 *
 * @param {object}        state
 * @param {string|number} year
 * @param {string}        progressDir
 */
export async function saveProgress(state, year, progressDir) {
  await mkdir(progressDir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(progressPath(year, progressDir), JSON.stringify(state, null, 2), 'utf8');
}

// ─── Actualización de una canción ─────────────────────────────────────────────

/**
 * Actualiza el estado de un id en memoria (no guarda a disco).
 * Llama a saveProgress() después si quieres persistir.
 *
 * @param {object} state  Estado de progreso del año
 * @param {string} id     ID de la canción (ej. "DE_3")
 * @param {object} patch  Campos a sobrescribir
 */
export function updateId(state, id, patch) {
  state.ids[id] = { ...(state.ids[id] || {}), ...patch };
}

// ─── Inicialización de ids desde CSV ─────────────────────────────────────────

/**
 * Añade filas del CSV al estado como `pending` solo si no existen ya.
 * Respeta estados existentes (no sobreescribe done/failed).
 *
 * @param {object}   state
 * @param {object[]} rows   Array de { id, banda, cancion, ... }
 */
export function initIds(state, rows) {
  for (const row of rows) {
    if (!state.ids[row.id]) {
      state.ids[row.id] = { status: 'pending' };
    }
  }
}

// ─── Consultas de estado ─────────────────────────────────────────────────────

/** Ids en un estado concreto */
export function getIdsByStatus(state, status) {
  return Object.entries(state.ids)
    .filter(([, v]) => v.status === status)
    .map(([id]) => id);
}

/** Conteo por estado */
export function countByStatus(state) {
  const counts = { pending: 0, downloading: 0, downloaded: 0, analyzing: 0, done: 0, failed: 0 };
  for (const v of Object.values(state.ids)) {
    counts[v.status] = (counts[v.status] || 0) + 1;
  }
  counts.total = Object.keys(state.ids).length;
  return counts;
}
