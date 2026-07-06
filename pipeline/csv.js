/**
 * pipeline/csv.js
 * Lectura y parseo del CSV FEP_{year}.csv
 *
 * Columnas: id, banda, canción, fecha, hora_de_inicio,
 *           hora_de_finalización, escenario, país, ciudad, idioma
 *
 * Maneja BOM, codificación Latin-1/UTF-8 y espacios en encabezados.
 */

import { createReadStream } from 'node:fs';
import { parse }            from 'csv-parse';

/**
 * Lee un CSV FEP y devuelve array de filas normalizadas.
 *
 * @param {string} csvPath  Ruta al archivo FEP_{year}.csv
 * @returns {Promise<Array<{ id, banda, cancion, fecha, escenario, pais, ciudad, idioma }>>}
 */
export async function readCsv(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = [];

    createReadStream(csvPath)
      .pipe(parse({
        columns:          true,
        skip_empty_lines: true,
        trim:             true,
        bom:              true,
        encoding:         'utf8',
        relax_column_count: true,
      }))
      .on('data', raw => {
        // Normalizar claves: quitar espacios, acentos simples y pasar a minúsculas
        const row = {};
        for (const [k, v] of Object.entries(raw)) {
          row[k.trim().toLowerCase().replace(/\s+/g, '_')] = (v || '').trim();
        }

        // Mapeo explícito de campos clave (el CSV tiene "canción" con tilde/encoding variable)
        const id      = row['id']     || '';
        const banda   = row['banda']  || '';
        const cancion = row['canci\u00f3n'] || row['cancion'] || row['canci³n'] || row['canciã³n'] || findCancionField(row);
        const fecha   = row['fecha']  || '';
        const escenario = row['escenario'] || '';
        const pais    = row['pa\u00eds'] || row['pais'] || row['pa\u00eds '] || row['pais '] || findPaisField(row) || '';
        const ciudad  = row['ciudad'] || '';
        const idioma  = row['idioma'] || row['idioma '] || '';

        if (!id || !banda || !cancion) return; // fila incompleta

        rows.push({ id, banda, cancion, fecha, escenario, pais, ciudad, idioma });
      })
      .on('end',   () => resolve(rows))
      .on('error', reject);
  });
}

/** Busca el campo de canción bajo cualquier variante de encoding */
function findCancionField(row) {
  for (const k of Object.keys(row)) {
    if (k.startsWith('canci')) return row[k];
  }
  return '';
}

/** Busca el campo de país bajo cualquier variante de encoding */
function findPaisField(row) {
  for (const k of Object.keys(row)) {
    if (k.startsWith('pa')) return row[k];
  }
  return '';
}
