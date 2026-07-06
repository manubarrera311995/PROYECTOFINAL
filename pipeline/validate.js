/**
 * pipeline/validate.js
 * Validación de JSONs generados y reporte quality_{year}.json
 *
 * Comprueba que cada {id}.json sea parseble, tenga el formato array[1]
 * y contenga los campos numéricos clave con valores en rango.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync }   from 'node:fs';
import { join, extname } from 'node:path';
import { readCsv }      from './csv.js';

// Campos numéricos requeridos y sus rangos válidos [min, max]
const NUMERIC_FIELDS = {
  danceability:    [0, 100],
  happy:           [0, 100],
  sad:             [0, 100],
  relaxed:         [0, 100],
  aggressive:      [0, 100],
  energy:          [0, 100],
  engagement:      [0, 100],
  nostalgia:       [0, 100],
  oscuridad:       [0, 100],
  tempo:           [30, 300],
  duration:        [1, 7200],
  sampleRate:      [8000, 48000],
};

const REQUIRED_STRING_FIELDS = ['keyNote', 'scale', 'moodSource', 'filename'];

// ─── Validación de un JSON individual ────────────────────────────────────────

/**
 * @param {string} jsonPath
 * @returns {{ ok: boolean, errors: string[] }}
 */
async function validateJson(jsonPath) {
  const errors = [];
  let raw;

  try {
    raw = await readFile(jsonPath, 'utf8');
  } catch (err) {
    return { ok: false, errors: [`No se puede leer: ${err.message}`] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['JSON inválido (no parseable)'] };
  }

  if (!Array.isArray(parsed)) {
    errors.push('No es un array');
  } else if (parsed.length === 0) {
    errors.push('Array vacío');
  } else {
    const d = parsed[0];

    for (const [field, [min, max]] of Object.entries(NUMERIC_FIELDS)) {
      if (!(field in d)) {
        errors.push(`Falta campo: ${field}`);
      } else if (typeof d[field] !== 'number' || isNaN(d[field])) {
        errors.push(`${field} no es número: ${d[field]}`);
      } else if (d[field] < min || d[field] > max) {
        errors.push(`${field} fuera de rango [${min},${max}]: ${d[field]}`);
      }
    }

    for (const field of REQUIRED_STRING_FIELDS) {
      if (!(field in d)) errors.push(`Falta campo: ${field}`);
    }

    // Consistencia happy + sad ≈ 100
    if ('happy' in d && 'sad' in d && Math.abs(d.happy + d.sad - 100) > 2) {
      errors.push(`happy(${d.happy}) + sad(${d.sad}) ≠ 100`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── Validación de una edición completa ──────────────────────────────────────

/**
 * Valida todos los JSONs en dataDir y genera reports/quality_{year}.json.
 *
 * @param {object} opts
 * @param {string|number} opts.year
 * @param {string}  opts.dataDir    Carpeta DATA_{year}/ con los JSONs
 * @param {string}  opts.reportDir  Carpeta reports/
 * @param {string}  [opts.csvPath]  CSV para contar el total esperado
 *
 * @returns {Promise<object>}  El objeto de reporte
 */
export async function validateEdition({ year, dataDir, reportDir, csvPath }) {
  if (!existsSync(dataDir)) {
    console.warn(`  [validate] Carpeta no encontrada: ${dataDir}`);
    return null;
  }

  // Leer todos los .json del directorio
  const files = (await readdir(dataDir))
    .filter(f => extname(f) === '.json' && f !== `quality_${year}.json`);

  const results  = { valid: [], invalid: [], missing: [] };

  for (const file of files) {
    const id       = file.replace('.json', '');
    const jsonPath = join(dataDir, file);
    const { ok, errors } = await validateJson(jsonPath);

    if (ok) {
      results.valid.push(id);
    } else {
      results.invalid.push({ id, errors });
    }
  }

  // Si tenemos el CSV, calcular ids que faltan en disco
  if (csvPath && existsSync(csvPath)) {
    const rows       = await readCsv(csvPath);
    const presentIds = new Set(files.map(f => f.replace('.json', '')));
    for (const row of rows) {
      if (!presentIds.has(row.id)) results.missing.push(row.id);
    }
  }

  const report = {
    year:        Number(year),
    total:       files.length + results.missing.length,
    done:        results.valid.length,
    invalid:     results.invalid.length,
    missing:     results.missing.length,
    failed:      results.invalid.length + results.missing.length,
    invalidIds:  results.invalid.map(r => r.id),
    missingIds:  results.missing,
    invalidDetails: results.invalid,
    generatedAt: new Date().toISOString(),
  };

  // Escribir reporte
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `quality_${year}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // Log resumen
  const status = report.failed === 0 ? '✅' : report.done > 0 ? '⚠️ ' : '✗';
  console.log(
    `  [${year}] ${status} ${report.done}/${report.total} válidos` +
    (report.invalid > 0 ? `  |  ${report.invalid} inválidos` : '') +
    (report.missing > 0 ? `  |  ${report.missing} sin JSON` : '') +
    `  →  ${reportPath}`
  );
  if (report.invalidDetails.length > 0) {
    for (const { id, errors } of report.invalidDetails.slice(0, 5)) {
      console.log(`       ✗ ${id}: ${errors.join('; ')}`);
    }
    if (report.invalidDetails.length > 5) {
      console.log(`       … y ${report.invalidDetails.length - 5} más (ver reporte)`);
    }
  }

  return report;
}
