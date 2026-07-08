<div align="center">

# Audio DNA Pipeline

**Pipeline batch para automatizar el procesamiento emocional de canciones del Festival Estéreo Picnic (FEP)**

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520_LTS-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Essentia](https://img.shields.io/badge/IA-Essentia%20MTG%20(MusiCNN)-4B8BBE)](https://essentia.upf.edu)
[![ffmpeg](https://img.shields.io/badge/audio-ffmpeg-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org)
[![Spotify](https://img.shields.io/badge/enriquecimiento-Spotify%20Web%20API-1DB954?logo=spotify&logoColor=white)](https://developer.spotify.com)
[![status](https://img.shields.io/badge/estado-v0.1.0-blue)](#)

```
FEP_{año}.csv  →  descarga WAV (yt-dlp)  →  análisis emocional (Essentia + DSP)  →  DATA_{año}/{id}.json
```

</div>

---

Dado un CSV con la programación de una edición del festival, el pipeline busca cada canción en YouTube, descarga el audio, lo analiza con modelos de Machine Learning (mood, bailabilidad) combinados con procesamiento de señal (DSP) y genera **un JSON por canción** con descriptores emocionales y acústicos — sin intervención manual. Opcionalmente enriquece cada canción con metadata de Spotify (portada, géneros).

## Índice

- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Uso rápido](#uso-rápido)
- [Todos los comandos](#todos-los-comandos)
- [Formato de salida](#formato-de-salida)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Rendimiento estimado](#rendimiento-estimado)
- [Variables de entorno](#variables-de-entorno-env)
- [Scripts de prueba](#scripts-de-prueba)
- [Documentación adicional](#documentación-adicional)

---

## Requisitos

| Herramienta | Versión mínima | Instalación |
|---|---|---|
| **Node.js** | 20 LTS | [nodejs.org](https://nodejs.org) |
| **ffmpeg** | cualquiera | `winget install Gyan.FFmpeg` / `brew install ffmpeg` |
| **yt-dlp** | cualquiera | `pip install yt-dlp` |

---

## Instalación

```bash
# 1. Dependencias Node
npm install

# 2. Configurar entorno
cp .env.example .env
# Editar .env con las rutas a tus CSV y carpeta de salida

# 3. Verificar que todo funciona
npm run test:models   # → 4/4 modelos OK
npm run test:core     # → analyzeBuffer OK
```

---

## Uso rápido

```bash
# Procesar UNA edición
npm run pipeline -- run --year 2013 \
  --csv ./data/csv/FEP_2013.csv \
  --output-dir ./data/output/DATA_2013

# Procesar TODAS las ediciones (rutas del .env)
npm run process:all

# Ver progreso
npm run pipeline -- status

# Reanudar pendientes/fallidos: vuelve a correr run, es idempotente
npm run pipeline -- run --year 2013

# Validar JSONs generados
npm run pipeline -- validate --year 2013

# (Opcional) enriquecer con datos de Spotify
npm run pipeline -- enrich --year 2013
```

---

## Todos los comandos

### `run` — descargar + analizar

`run` es idempotente: se puede volver a ejecutar las veces que sea necesario. Omite (`--skip-existing`, activo por defecto) los ids que ya tienen JSON válido en disco, y reprocesa automáticamente cualquier id pendiente, fallido o que haya quedado a medias por una interrupción anterior. Por eso también sirve como comando de "reintentar" — no existe un comando `retry` separado.

```bash
npm run pipeline -- run [alcance] [rutas] [opciones]

# Alcance
--year 2013               Una edición
--years 2013,2014,2015    Varias ediciones
--all                     Todas (detecta FEP_*.csv en --csv-dir)

# Rutas
--csv PATH                CSV de entrada (para --year)
--csv-dir PATH            Carpeta con todos los FEP_*.csv  [default: CSV_DIR en .env o ./data/csv]
--output-dir PATH         Carpeta de salida JSON (para --year)
--output-base PATH        Base para DATA_{year}/           [default: OUTPUT_BASE en .env o ./data/output]
--downloads-dir PATH      WAVs temporales                  [default: ./downloads]
--progress-dir PATH       Estado de progreso               [default: ./progress]

# Comportamiento
--no-skip-existing        Reprocesar aunque el JSON ya exista
--delete-wav-after        Borrar WAV tras análisis exitoso (ahorra disco)
--download-workers N      Descargas simultáneas            [default: 1; rec: 3-4]
--analyze-workers N       Análisis simultáneos             [default: 1; rec: 2-3]
```

### `download` — solo descargar WAV

```bash
npm run pipeline -- download --year 2013 --csv ./data/csv/FEP_2013.csv
```

### `analyze` — solo analizar WAVs ya descargados

```bash
npm run pipeline -- analyze --year 2013 --output-dir ./data/output/DATA_2013
```

### `status` — ver progreso

```bash
npm run pipeline -- status            # todas las ediciones con progreso
npm run pipeline -- status --year 2013
```

Ejemplo de salida:
```
── Estado del pipeline ──────────────────────

  2013  [████████░░░░░░░░░░░░]  40%  105/262 done  3 failed  154 pendiente
```

### `validate` — reporte de calidad

```bash
npm run pipeline -- validate                    # todas las ediciones
npm run pipeline -- validate --year 2013
```

Genera `reports/quality_{year}.json` con conteos y detalles de errores.

### `enrich` — enriquecer con Spotify

```bash
npm run pipeline -- enrich --year 2013
```

Agrega portada de álbum, géneros musicales y confianza del match a cada JSON ya generado. Requiere `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` en `.env`. Ver el detalle de qué campos toca en el [diccionario de datos](docs/DICCIONARIO_DE_DATOS.md#7-enriquecimiento-spotify).

---

## Formato de salida

Cada canción genera `DATA_{year}/{id}.json` (array de un elemento):

```json
[{
  "danceability": 43,
  "happy": 31,  "sad": 69,
  "relaxed": 34,  "aggressive": 75,
  "energy": 97,  "tempo": 200,
  "nostalgia": 49,  "oscuridad": 92,  "engagement": 50,
  "keyNote": "B",  "scale": "Menor",  "loudness_db": -13,
  "spotifyTrackName": "Telescopio",  "spotifyArtist": "Diamante Eléctrico",
  "moodSource": "Essentia MTG ML",
  "duration": 201.4,  "sampleRate": 16000,
  "filename": "Diamante Eléctrico - Telescopio",
  ...
}]
```

El campo `moodSource` indica si usó los modelos Essentia (`"Essentia MTG ML"`) o el fallback DSP (`"DSP heurístico"`).

> **¿De dónde sale cada atributo?** La explicación completa — qué modelo o fórmula genera cada campo, sus rangos, y cuáles solo aparecen tras enriquecer con Spotify — está en **[docs/DICCIONARIO_DE_DATOS.md](docs/DICCIONARIO_DE_DATOS.md)**.

---

## Estructura del repositorio

```
PROYECTOFINAL/
├── core/
│   ├── dsp.js           # FFT, Mel, features acústicos
│   ├── calibration.js   # Mood heurístico, calibración, descriptores
│   └── analyzer.js      # analyzeBuffer() — punto de entrada
├── pipeline/
│   ├── csv.js           # Lector FEP_*.csv
│   ├── download.js      # yt-dlp → WAV
│   ├── analyze.js       # ffmpeg + analyzeBuffer → JSON
│   ├── spotify.js       # Cliente Spotify Web API + scoring de match
│   ├── enrich.js        # Orquestación del enriquecimiento Spotify
│   ├── progress.js      # Estado persistente progress/{year}.json
│   ├── runner.js        # Orquestación con workers
│   ├── validate.js      # Validación de JSONs
│   └── cli.js           # CLI principal
├── docs/
│   └── DICCIONARIO_DE_DATOS.md  # Origen y cálculo de cada campo del JSON
├── models/              # Modelos Essentia TF.js (gitignored)
├── scripts/             # Setup y pruebas
├── downloads/           # WAVs temporales (gitignored)
├── progress/            # Estado de progreso (gitignored)
└── reports/             # Reportes de calidad (gitignored)
```

---

## Rendimiento estimado

| Alcance | Sin optimizar (1 worker) | Con workers (dl:4, an:2) |
|---|---|---|
| 1 edición (~262 canciones) | ~4–8 h | **~1–3 h** |
| 15 ediciones (~3.900 canciones) | ~2–3 días | **~1–2 días** |

El tiempo real depende de la velocidad de internet y del procesador. El cuello de botella es la **descarga de YouTube** (~70% del tiempo). Aumentar `--download-workers` es la optimización más efectiva.

> **Nota:** YouTube puede bloquear IPs con muchas peticiones simultáneas.
> Con 3–4 workers y los reintentos automáticos incluidos, el pipeline se recupera solo de la mayoría de bloqueos transitorios.

---

## Variables de entorno (`.env`)

Ver `.env.example` para la lista completa. Las más importantes:

```env
CSV_DIR=./data/csv
OUTPUT_BASE=./data/output
DOWNLOAD_WORKERS=4
ANALYZE_WORKERS=2
DELETE_WAV_AFTER=false
```

---

## Scripts de prueba

```bash
npm run test:models    # Verifica los 4 modelos Essentia
npm run test:core      # Prueba analyzeBuffer con PCM sintético
npm run test:download  # Descarga 1 canción real (DE_3 Telescopio)
npm run test:analyze   # Analiza el WAV descargado → JSON
npm run test:spotify   # Verifica credenciales y búsqueda Spotify
```

---

## Documentación adicional

| Documento | Contenido |
|---|---|
| **[MANUAL_USUARIO.md](MANUAL_USUARIO.md)** | Guía paso a paso para instalar y correr el pipeline desde cero (pensada para usuarios no técnicos) |
| **[docs/DICCIONARIO_DE_DATOS.md](docs/DICCIONARIO_DE_DATOS.md)** | De dónde sale y cómo se calcula cada atributo del JSON de resultado (modelo de IA, fórmula DSP, CSV o Spotify) |

---

*Audio DNA Pipeline v0.1.0*
