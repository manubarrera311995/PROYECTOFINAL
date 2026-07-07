# Audio DNA Pipeline

Pipeline batch para automatizar el procesamiento de canciones del **Festival Estéreo Picnic (FEP)**:

```
FEP_{year}.csv → descarga WAV (yt-dlp) → análisis emocional (Essentia + DSP) → DATA_{year}/{id}.json
```

Genera JSONs con descriptores emocionales por canción sin intervención manual.

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

# Reintentar los que fallaron
npm run pipeline -- retry --year 2013

# Validar JSONs generados
npm run pipeline -- validate --year 2013
```

---

## Todos los comandos

### `run` — descargar + analizar

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

### `retry` — reintentar fallidos

```bash
npm run pipeline -- retry --year 2013
npm run pipeline -- retry --all   # todas las ediciones
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
│   ├── progress.js      # Estado persistente progress/{year}.json
│   ├── runner.js        # Orquestación con workers
│   ├── validate.js      # Validación de JSONs
│   └── cli.js           # CLI principal
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
```
