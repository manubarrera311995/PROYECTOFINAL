/**
 * Descarga de audio desde YouTube vía yt-dlp.
 * Fase 3 — CSV fila → downloads/{year}/{id}.wav
 */

export async function downloadTrack({ id, banda, cancion, year, outputDir }) {
  throw new Error(
    `downloadTrack aún no implementado (Fase 3): ${id} — ${banda} - ${cancion} (${year}) → ${outputDir}`
  );
}
