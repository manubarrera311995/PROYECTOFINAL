# Diccionario de datos — JSON de resultado

Este documento explica **de dónde sale cada atributo** de los archivos `DATA_{año}/{id}.json` que genera el pipeline. Para cada campo se indica su **origen** (qué componente del código lo calcula), **cómo se calcula** y su **rango/tipo**.

Si buscas cómo *usar* el pipeline, revisa el [README](../README.md) o el [Manual de Usuario](../MANUAL_USUARIO.md). Este documento es la referencia técnica de los datos, no de los comandos.

---

## Índice

- [Resumen del flujo de datos](#resumen-del-flujo-de-datos)
- [1. Moods principales (IA / DSP)](#1-moods-principales-ia--dsp)
- [2. Descriptores compuestos (heurísticas DSP)](#2-descriptores-compuestos-heurísticas-dsp)
- [3. Energía y tempo](#3-energía-y-tempo)
- [4. Features espectrales (DSP puro)](#4-features-espectrales-dsp-puro)
- [5. Campos de audio features (reservados)](#5-campos-de-audio-features-reservados)
- [6. Metadata de la canción (CSV)](#6-metadata-de-la-canción-csv)
- [7. Enriquecimiento Spotify](#7-enriquecimiento-spotify)
- [8. Género musical](#8-género-musical)
- [9. Trazabilidad y metadata técnica](#9-trazabilidad-y-metadata-técnica)
- [Ejemplo completo comentado](#ejemplo-completo-comentado)

---

## Resumen del flujo de datos

Cada canción pasa por estas etapas antes de que su JSON quede completo. El origen de cada campo depende de en qué etapa se rellena:

```
FEP_{año}.csv                    → id, banda, canción (metadata de origen)
        │
        ▼
yt-dlp descarga el audio          → pipeline/download.js
        │
        ▼
ffmpeg decodifica a PCM            → pipeline/analyze.js  (decodeAudioToPcm)
  (16 kHz, mono, float32)
        │
        ▼
core/dsp.js  computeAcousticFeatures  → features espectrales "crudos" (RMS, ZCR,
        │                                centroide, rolloff, flatness, chroma…)
        ▼
core/analyzer.js  analyzeBuffer()
        │
        ├─► Modelos Essentia (TensorFlow.js) → happy, relaxed, aggressive, danceable
        │   (si no cargan o dan scores "planos" → fallback DSP heurístico)
        │
        ├─► core/calibration.js  calibrateMood()      → corrige scores extremos con DSP
        ├─► core/calibration.js  computeCompositeDescriptors()  → engagement, nostalgia, oscuridad...
        └─► core/calibration.js  buildDescriptors()    → arma el objeto final
        │
        ▼
pipeline/analyze.js   → agrega filename, spotifyTrackName/Artist provisionales (=CSV)
        │
        ▼
DATA_{año}/{id}.json  (array de 1 elemento)
        │
        ▼ (opcional, comando `enrich`)
pipeline/spotify.js + pipeline/enrich.js
        → sobreescribe campos spotify*, deriva genre/subgenre
```

En resumen, hay **tres fuentes de datos** distintas mezcladas en el mismo JSON:

| Fuente | Campos que produce |
|---|---|
| **CSV del festival** (`FEP_{año}.csv`) | `filename` y valores iniciales de `spotifyTrackName` / `spotifyArtist` (antes de enriquecer) |
| **Análisis de audio** (DSP + modelos Essentia) | Todos los moods, descriptores compuestos, energía, tempo, features espectrales |
| **API de Spotify** (paso opcional `enrich`) | `spotifyAlbumArt`, `spotifyGenres`, `spotifyMatchConfidence`, `spotifyId`, `genre`, `subgenre`, y puede sobreescribir `spotifyTrackName`/`spotifyArtist` |

---

## 1. Moods principales (IA / DSP)

Estos cinco campos vienen de **modelos de Machine Learning de Essentia** (redes MusiCNN entrenadas para clasificación de mood), ubicados en `models/*-musicnn/`. Si los modelos no están disponibles, o si sus 4 scores salen "planos" (sin discriminación, todos ≈ 0.5), el sistema cae automáticamente a un **heurístico DSP puro** basado en energía, timbre y armonía. El campo `moodSource` (ver sección 9) indica cuál de las dos fuentes se usó.

| Campo | Tipo | Rango | Origen |
|---|---|---|---|
| `danceability` | int | 0–100 | Modelo `danceability-musicnn`. Fallback DSP: combina energía en graves, RMS y "planitud" espectral (`computeHeuristicMood` en `core/calibration.js`). |
| `happy` | int | 0–100 | Modelo `mood_happy-musicnn`. Fallback DSP: combina balance armónico mayor/menor (chroma), brillo espectral (centroide) y zero-crossing rate. |
| `sad` | int | 0–100 | Siempre calculado como `100 - happy` (no es un modelo independiente). |
| `relaxed` | int | 0–100 | Modelo `mood_relaxed-musicnn`. Fallback DSP: inverso de energía (RMS), inverso de ZCR e inverso de "flatness" espectral. |
| `aggressive` | int | 0–100 | Modelo `mood_aggressive-musicnn`. Fallback DSP: energía (RMS), ZCR y proporción de energía en agudos. |

**Calibración (solo si vino de Essentia):** antes de redondear a porcentaje, `calibrateMood()` en `core/calibration.js` corrige casos donde el modelo predice "agresivo" con energía DSP muy baja (o "relajado" con energía DSP muy alta), mezclando el score del modelo con las señales acústicas reales para evitar falsos positivos.

Los scores internos (0–1) de los modelos/heurística se convierten a porcentaje entero con `pct(v) = round(clamp(v, 0, 1) * 100)`.

**¿Qué es un "pseudo-embedding"?** Los modelos Essentia esperan como entrada un vector de 200 valores que aproxima el embedding de audio de MusiCNN (`computePseudoEmbeddings` en `core/dsp.js`): estadísticas de un banco de 96 filtros Mel (media y variación) más 8 features globales (RMS, ZCR, centroide, flatness, balance de bandas). No es el modelo MusiCNN completo, es una aproximación ligera para poder correr en Node sin GPU.

---

## 2. Descriptores compuestos (heurísticas DSP)

Estos campos **no vienen de ningún modelo de IA**: son fórmulas matemáticas (regresiones logísticas manuales) que combinan los moods de la sección 1 con features acústicos crudos. Se calculan en `computeCompositeDescriptors()` (`core/calibration.js`).

| Campo | Tipo | Rango | Cómo se calcula |
|---|---|---|---|
| `engagement` | int | 0–100 | 35% energía (RMS) + 30% variabilidad de energía (RMS std) + 20% brillo espectral (centroide) + 15% `danceable`. Mide qué tan "activa"/dinámica es la pista. |
| `approachability` | int | 0–100 | 35% (1 − flatness) + 25% (1 − brillo espectral) + 25% `happy` + 15% (1 − energía). Mide qué tan "accesible"/poco ruidosa suena. *(Se calcula pero no se incluye en el objeto final devuelto por `buildDescriptors` — ver nota abajo.)* |
| `nostalgia` | int | 0–100 | Combina (1 − `happy`), "acusticidad" (1 − flatness), `relaxed`, baja energía, cercanía del tempo a ~85 BPM y (1 − `aggressive`), pasado por una sigmoide para acentuar los extremos. |
| `oscuridad` | int | 0–100 | Combina si la tonalidad es menor (`scale === 'Menor'`), `aggressive`, timbre oscuro (centroide bajo) y (1 − `happy`), pasado por una sigmoide. |

> **Nota:** `buildDescriptors()` solo escribe `engagement`, `nostalgia` y `oscuridad` en el JSON final; `approachability` se calcula internamente pero actualmente no se persiste en el archivo de salida.

---

## 3. Energía y tempo

| Campo | Tipo | Rango | Origen |
|---|---|---|---|
| `energy` | int | 0–100 | Deriva directamente del volumen RMS promedio del audio: `round(clamp(rms_mean / 0.3, 0, 1) * 100)`. Cuanto más "fuerte"/comprimida suena la pista, más alto. |
| `tempo` | int | 60–200 (BPM) | **Estimación heurística**, no una detección real de tempo/beat-tracking: `round(clamp(60 + zcr_mean * 800, 60, 200))`. Se basa en la tasa de cruces por cero, que suele correlacionar con la densidad rítmica pero no equivale a un algoritmo de BPM dedicado (ej. onset detection). Trátalo como una aproximación, no como el BPM exacto de la canción. |

---

## 4. Features espectrales (DSP puro)

Todos estos campos salen de `computeAcousticFeatures()` en `core/dsp.js`, que analiza el audio en ventanas de 2048 muestras (frames) con solapamiento (hop 1024), hasta 150 frames por canción, y agrega los resultados con media/desviación estándar.

| Campo | Tipo | Origen / cálculo |
|---|---|---|
| `keyNote` | string (`"C"`…`"B"`) | Nota con mayor energía promedio en el vector de croma (12 semitonos), calculado por FFT sobre cada frame. |
| `scale` | string (`"Mayor"` / `"Menor"`) | Compara la energía de los acordes típicos de tónica mayor (I, IV, V) contra los de tónica menor; el que tenga más energía relativa gana. |
| `loudness_db` | number (dB, típ. negativo) | `20 * log10(rms_mean)`, redondeado. Aproximación simple de "volumen percibido" en decibelios. |
| `spectralCentroid` | int (Hz) | Centro de masa del espectro de frecuencias — indica el "brillo" del sonido (valores altos = más agudo). |
| `spectralRolloff` | int (Hz) | Frecuencia por debajo de la cual se concentra el 85% de la energía espectral. |
| `spectralFlatness` | int (0–100) | Qué tan "ruidoso"/plano es el espectro vs. tonal (relación media geométrica / media aritmética de la magnitud espectral), expresado como porcentaje. |
| `zeroCrossingRate` | number (0–100, con 2 decimales) | Cuántas veces por frame la señal cruza el cero, indicador aproximado de contenido de altas frecuencias / percusividad. |
| `lowFreqRatio` | int (%) | % de la energía espectral total que cae en graves (< 300 Hz aprox., ver `frameFeats`). |
| `midFreqRatio` | int (%) | % de la energía espectral total en medios (300 Hz – 2 kHz aprox.). |
| `highFreqRatio` | int (%) | % de la energía espectral total en agudos (> 2 kHz aprox.). |

---

## 5. Campos de audio features (reservados)

| Campo | Valor actual | Motivo |
|---|---|---|
| `instrumentalness` | `null` | Reservado para una futura fuente de datos (ej. Spotify Audio Features). El pipeline actual no lo calcula ni lo obtiene de ninguna API. |
| `liveness` | `null` | Igual que arriba. |
| `speechiness` | `null` | Igual que arriba. |

> Spotify deprecó el acceso público al endpoint de *Audio Features* (`/v1/audio-features`) para apps nuevas, por lo que estos tres campos quedan como placeholder en `buildDescriptors()` a la espera de una fuente alternativa.

---

## 6. Metadata de la canción (CSV)

| Campo | Origen |
|---|---|
| `filename` | Se construye como `"{banda} - {canción}"` a partir de las columnas `banda` y `canción` del CSV de entrada (`deriveFilename()` en `pipeline/analyze.js`). |

El CSV (`pipeline/csv.js`) también lee `fecha`, `escenario`, `país`, `ciudad` e `idioma` de cada fila, pero **estos campos no se copian al JSON de salida actualmente** — solo se usan `id`, `banda` y `canción` (para buscar el audio en YouTube y nombrar el archivo).

---

## 7. Enriquecimiento Spotify

Estos campos empiezan **vacíos/provisionales** al generarse el JSON (paso `run`/`analyze`) y solo se completan de verdad si corres `npm run pipeline -- enrich --year N` **y** tienes credenciales de Spotify configuradas en `.env`. La lógica vive en `pipeline/spotify.js` (búsqueda y scoring) y `pipeline/enrich.js` (orquestación, qué se sobreescribe).

| Campo | Antes de `enrich` | Después de `enrich` (match aceptado) |
|---|---|---|
| `spotifyTrackName` | Nombre de la canción tal como está en el CSV | Nombre exacto del track según Spotify |
| `spotifyArtist` | Nombre de la banda tal como está en el CSV | Nombre(s) de artista según Spotify (une varios con coma si hay features) |
| `spotifyAlbumArt` | `null` | URL de la portada del álbum (`album.images[0].url`) |
| `spotifyGenres` | `[]` | Géneros crudos asociados al **artista** en Spotify (`GET /artists/{id}`), no al track |
| `spotifyMatchConfidence` | `0` | Score combinado 0–100: `60% similitud de título + 40% similitud de artista` (función `score()`, comparación de texto normalizado) |
| `spotifyId` | *(no existe)* | ID del track en Spotify — solo se agrega si hubo match aceptado |
| `spotifyEnrichedAt` | *(no existe)* | Timestamp ISO de cuándo se procesó (existe aunque el resultado sea "no encontrado" — marca que ya se intentó) |

### Campos que solo aparecen en casos especiales

| Campo | Cuándo aparece |
|---|---|
| `spotifySearchCandidate` | Cuando hubo un resultado en Spotify pero **no pasó el umbral de aceptación automática** (título o artista no coinciden lo suficiente, o la duración difiere más del 15%). Contiene el track candidato completo (`spotifyTrackName`, `spotifyArtist`, `spotifyAlbumArt`, `spotifyId`, `titleScore`, `artistScore`, `combinedScore`, `durationDiffPct`) para revisión manual. Se limpia automáticamente si una corrida posterior sí logra un match aceptado. |
| `spotifyMatchReason` | Acompaña a `spotifySearchCandidate`. Uno de: `titulo_no_coincide`, `artista_no_coincide`, `duracion_no_coincide`. |
| `spotifyMatchSkipped` | Vale `"cover_or_live"` cuando el título contiene patrones como `(Cover)`, `(Live)`, `(En Vivo)`, `(Acoustic)`, `(Remix)`, etc. — se omite la búsqueda porque casi nunca existe en Spotify bajo el artista que tocó esa versión. |

**Umbrales usados para decidir el estado** (`pipeline/spotify.js`):

| Umbral | Valor | Efecto |
|---|---|---|
| `MIN_TITLE_SCORE` | 55 | Score mínimo de similitud de título para aceptar automáticamente |
| `MIN_ARTIST_SCORE` | 55 | Score mínimo de similitud de artista para aceptar automáticamente |
| `CANDIDATE_MIN_SCORE` | 30 | Por debajo de esto, ni se guarda como candidato (`not_found`) |
| `DURATION_TOLERANCE_PCT` | 15% | Diferencia máxima tolerada entre la duración del audio analizado y la duración reportada por Spotify |

Todos los candidatos dudosos y covers omitidos de una corrida de `enrich` también quedan resumidos en `reports/spotify_review_{año}.json` para auditoría rápida sin tener que abrir cada JSON.

---

## 8. Género musical

| Campo | Origen |
|---|---|
| `genre` | Derivado de `spotifyGenres` mediante reglas de palabras clave (`GENRE_RULES` en `pipeline/spotify.js`, función `deriveGenre()`). Ej.: si algún tag de Spotify contiene `"rock"`, `"punk"`, `"grunge"`, etc. → `genre = "Rock"`. Si ningún tag coincide con ninguna regla, se asigna `"Otro"`. Vacío (`""`) si Spotify no devolvió géneros. |
| `subgenre` | El tag de Spotify específico que disparó la regla (ej. `"indie rock"`), o el primer tag crudo si no hubo match con ninguna categoría. |
| `genreExplanation` | Texto generado automáticamente listando los tags de Spotify usados para la clasificación (ej. `"Derivado de tags Spotify: rock, indie rock, alternative rock"`). |
| `genreConfidence` | `80` si el género coincidió con una regla conocida, `40` si se asignó `"Otro"` sin match, `0` si no hay géneros de Spotify disponibles. Es una confianza heurística fija, no una probabilidad estadística. |

> El género se deriva de los **géneros del artista** en Spotify (no existen géneros por canción en la API pública), por lo que puede no ser preciso para artistas versátiles o colaboraciones.

---

## 9. Trazabilidad y metadata técnica

| Campo | Tipo | Origen |
|---|---|---|
| `moodSource` | string | `"Essentia MTG ML"` si los 4 modelos de mood cargaron y dieron scores con suficiente discriminación; `"DSP heurístico"` si se usó el fallback matemático (`core/analyzer.js`). Útil para saber qué tan confiable es el análisis de mood de esa fila. |
| `duration` | number (segundos) | `longitud_del_PCM / sampleRate`, calculado sobre el audio completo decodificado por ffmpeg (no solo los 24 s de muestra usados para el análisis DSP/IA). |
| `sampleRate` | int | Siempre `16000` — es la tasa de muestreo objetivo a la que `ffmpeg` re-samplea el audio antes de analizarlo (`TARGET_SR` en `pipeline/analyze.js`). |
| `channels` | int | Siempre `1` (mono) — ffmpeg fuerza `-ac 1` al decodificar. |

---

## Ejemplo completo comentado

```jsonc
[{
  // ── Moods (IA Essentia o fallback DSP) ──────────────────────
  "danceability": 43,          // modelo danceability-musicnn
  "happy": 31,                 // modelo mood_happy-musicnn
  "sad": 69,                   // = 100 - happy
  "relaxed": 34,                // modelo mood_relaxed-musicnn
  "aggressive": 75,            // modelo mood_aggressive-musicnn (calibrado con DSP)

  // ── Descriptores compuestos (fórmulas DSP) ──────────────────
  "engagement": 50,            // RMS + variabilidad + centroide + danceable
  "nostalgia": 49,             // (1-happy) + acusticidad + relaxed + tempo≈85bpm
  "oscuridad": 92,             // modo menor + aggressive + timbre oscuro

  // ── Energía / tempo (DSP) ────────────────────────────────────
  "energy": 97,                // RMS promedio normalizado
  "tempo": 200,                // estimación heurística vía zero-crossing rate

  // ── Espectrales (DSP puro, FFT + croma) ──────────────────────
  "keyNote": "B",
  "scale": "Menor",
  "loudness_db": -13,
  "spectralCentroid": 2450,
  "spectralRolloff": 5200,
  "spectralFlatness": 18,
  "zeroCrossingRate": 12.5,
  "lowFreqRatio": 40, "midFreqRatio": 45, "highFreqRatio": 15,

  // ── Reservados (sin fuente de datos actualmente) ─────────────
  "instrumentalness": null, "liveness": null, "speechiness": null,

  // ── Metadata CSV ──────────────────────────────────────────────
  "filename": "Diamante Eléctrico - Telescopio",   // "{banda} - {canción}" del CSV

  // ── Spotify (tras correr `enrich`; antes: null/[]/0) ─────────
  "spotifyTrackName": "Telescopio",
  "spotifyArtist": "Diamante Eléctrico",
  "spotifyAlbumArt": "https://i.scdn.co/image/...",
  "spotifyGenres": ["colombian rock", "latin alternative"],
  "spotifyMatchConfidence": 94,
  "spotifyId": "3n2b8...",
  "spotifyEnrichedAt": "2026-07-08T20:12:31.000Z",

  // ── Género derivado de spotifyGenres ─────────────────────────
  "genre": "Rock",
  "subgenre": "colombian rock",
  "genreExplanation": "Derivado de tags Spotify: colombian rock, latin alternative",
  "genreConfidence": 80,

  // ── Trazabilidad ──────────────────────────────────────────────
  "moodSource": "Essentia MTG ML",
  "duration": 201.4,
  "sampleRate": 16000,
  "channels": 1
}]
```

---

*Diccionario de datos — Audio DNA Pipeline v0.1.0*
