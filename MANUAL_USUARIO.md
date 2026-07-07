# Manual de Usuario — Audio DNA Pipeline

**Versión:** 0.1.0  
**Sistema operativo:** macOS  

---

## ¿Qué hace este programa?

El **Audio DNA Pipeline** automatiza el procesamiento de canciones del **Festival Estéreo Picnic (FEP)**. Dado un archivo CSV con la programación de un año del festival, el programa:

1. Busca cada canción en YouTube y descarga el audio.
2. Analiza el audio para extraer características emocionales (energía, felicidad, agresividad, bailabilidad, etc.) usando modelos de inteligencia artificial.
3. Genera un archivo JSON por canción con todos esos datos.
4. (Opcional) Enriquece cada canción con información adicional de Spotify.

---

## Lo que viene incluido

```
PROYECTOFINAL/
├── core/          ← Motor de análisis de audio
├── pipeline/      ← Lógica del pipeline y CLI
├── scripts/       ← Scripts de prueba y configuración
├── models/        ← Modelos de IA (ya incluidos, no requieren instalación extra)
├── .env.example   ← Plantilla de configuración
└── package.json
```

Lo que **no** viene incluido y debes tener tú:

- Los archivos `FEP_{año}.csv` con la programación del festival.
- Una carpeta destino donde se guardarán los JSONs generados.

---

## Paso 1 — Instalar las herramientas necesarias

Abre la aplicación **Terminal** (la encuentras en `Aplicaciones → Utilidades → Terminal`, o búscala con Spotlight `⌘ + Espacio`).

### 1.1 Homebrew (gestor de paquetes para Mac)

Homebrew permite instalar programas de desarrollo fácilmente. Si no lo tienes, pega este comando en Terminal y presiona Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Sigue las instrucciones en pantalla. Al finalizar, si el terminal te indica que ejecutes comandos adicionales para agregar `brew` al PATH, hazlo antes de continuar.

Verifica que quedó instalado:

```bash
brew --version
```

### 1.2 Node.js 20

```bash
brew install node@20
```

Verifica:

```bash
node --version   # debe mostrar v20.x.x o superior
```

> Si después de instalar el comando `node` no se encuentra, ejecuta esto y vuelve a intentarlo:
> ```bash
> echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
> ```

### 1.3 ffmpeg (procesador de audio)

```bash
brew install ffmpeg
```

Verifica:

```bash
ffmpeg -version
```

### 1.4 Python 3 y yt-dlp (descargador de YouTube)

Python 3 ya viene en macOS moderno. Instala yt-dlp:

```bash
pip3 install yt-dlp
```

Verifica:

```bash
yt-dlp --version
```

> Si `pip3` no está disponible, instala Python con Homebrew primero:
> ```bash
> brew install python && pip3 install yt-dlp
> ```

---

## Paso 2 — Preparar el proyecto

### 2.1 Navegar a la carpeta del proyecto

```bash
cd ~/Desktop/PROYECTOFINAL
```

> Ajusta la ruta si guardaste la carpeta en otro lugar. Por ejemplo, si está en Documentos:
> ```bash
> cd ~/Documents/PROYECTOFINAL
> ```

### 2.2 Instalar dependencias

```bash
npm install
```

Esto descargará las librerías necesarias. Puede tardar 2–5 minutos.

### 2.3 Crear el archivo de configuración

```bash
cp .env.example .env
```

Ahora abre el archivo `.env` con cualquier editor de texto y configura las rutas según dónde tengas tus archivos. El archivo se ve así:

```env
# ── Rutas ────────────────────────────────────────────────────
# Carpeta donde están tus archivos FEP_*.csv
CSV_DIR=./data/csv

# Carpeta base donde se crearán las subcarpetas DATA_{año}/
OUTPUT_BASE=./data/output

# ── Paralelismo ───────────────────────────────────────────────
DOWNLOAD_WORKERS=4
ANALYZE_WORKERS=2

# ── Comportamiento ────────────────────────────────────────────
DELETE_WAV_AFTER=false

# ── Spotify (opcional) ───────────────────────────────────────
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_ENRICH=false
```

**Opciones de configuración de rutas:**

**Opción A — Guardar todo dentro del proyecto** *(más simple)*

Crea las carpetas necesarias:
```bash
mkdir -p data/csv data/output
```
Copia tus archivos `FEP_*.csv` dentro de `data/csv/`. No necesitas cambiar nada en `.env`.

**Opción B — Usar carpetas en otro lugar de tu Mac**

Edita las rutas en `.env` con la ubicación real de tus archivos:
```env
CSV_DIR=/Users/tu-nombre/Documentos/festival/csvs
OUTPUT_BASE=/Users/tu-nombre/Documentos/festival/output
```

> **Nota sobre los workers:** Son hilos de trabajo simultáneo. `DOWNLOAD_WORKERS=4` descarga 4 canciones al mismo tiempo y `ANALYZE_WORKERS=2` analiza 2 a la vez. Valores más altos = más rápido, pero más uso de CPU/RAM. Los valores por defecto son un buen punto de partida.

---

## Paso 3 — Verificar que todo funciona

Antes de procesar el festival completo, corre estas pruebas:

```bash
npm run test:models
```

Salida esperada:
```
✓ mood_happy-musicnn  OK
✓ mood_relaxed-musicnn  OK
✓ mood_aggressive-musicnn  OK
✓ danceability-musicnn  OK
4/4 modelos cargados correctamente
```

```bash
npm run test:core
```

Salida esperada:
```
analyzeBuffer OK — danceability: 52, happy: 41, energy: 63 ...
```

Si ambas pruebas pasan, el sistema está listo para procesar.

---

## Paso 4 — Procesar una edición del festival

### Usando las rutas configuradas en `.env`

Si configuraste `CSV_DIR` y `OUTPUT_BASE` en el paso anterior:

```bash
npm run pipeline -- run --year 2013 --download-workers 4 --analyze-workers 2
```

### Especificando las rutas directamente

Si prefieres indicar las rutas cada vez:

```bash
npm run pipeline -- run \
  --year 2013 \
  --csv /ruta/a/FEP_2013.csv \
  --output-dir /ruta/donde/guardar/DATA_2013 \
  --download-workers 4 \
  --analyze-workers 2
```

### Lo que verás en pantalla

```
── Audio DNA Pipeline ──────────────────────────────────────────
  Edición: 2013  |  262 canciones
  Descargando: [████░░░░░░░░░░░░░░░░]  4 workers
  Analizando:  [██░░░░░░░░░░░░░░░░░░]  2 workers
  Completadas: 45/262  |  Fallidas: 2  |  Pendientes: 215
```

> **Tiempo estimado:** Aproximadamente 1–3 horas para ~262 canciones con workers dl:4, an:2. El tiempo varía según la velocidad de internet y el procesador. Deja el Mac conectado a la corriente y configúralo para que no entre en reposo: `Configuración del Sistema → Batería → Evitar que el ordenador entre en reposo`.

### ¿Se puede pausar y reanudar?

Sí. Si cierras Terminal o apagas el Mac, el progreso se guarda automáticamente. Al ejecutar el mismo comando de nuevo, el pipeline retoma desde donde quedó, saltando las canciones ya procesadas.

### Ver el progreso desde otra ventana

Abre una segunda ventana de Terminal, navega al proyecto y ejecuta:

```bash
npm run pipeline -- status --year 2013
```

Para un monitor en vivo que se actualiza cada 10 segundos:

```bash
npm run pipeline -- status --year 2013 --watch 10
```

---

## Paso 5 — Reintentar canciones fallidas

Algunas canciones pueden fallar porque YouTube no encontró el audio o hubo un error de red. Al terminar, ejecuta:

```bash
npm run pipeline -- retry --year 2013
```

---

## Paso 6 — Validar los resultados

```bash
npm run pipeline -- validate --year 2013
```

Genera `reports/quality_2013.json` con un resumen:
```
✓ Válidos: 258
✗ Inválidos: 0
⚠ Faltantes: 4
```

---

## Paso 7 (Opcional) — Enriquecer con datos de Spotify

Este paso agrega portadas de álbum, géneros musicales y metadatos adicionales a cada JSON.

### Crear credenciales gratuitas de Spotify

1. Ve a [developer.spotify.com](https://developer.spotify.com) e inicia sesión con tu cuenta de Spotify.
2. Haz clic en **"Create app"**.
3. Dale un nombre cualquiera (ej. "AudioDNA"), agrega una descripción breve, y en "Redirect URIs" escribe `http://localhost`.
4. Copia el **Client ID** y el **Client Secret** que aparecen en la app.

### Configurar en `.env`

```env
SPOTIFY_CLIENT_ID=pega_aqui_tu_client_id
SPOTIFY_CLIENT_SECRET=pega_aqui_tu_client_secret
```

### Ejecutar el enriquecimiento

```bash
npm run pipeline -- enrich --year 2013
```

---

## Flujo completo de referencia

```
1. npm install                        → instala dependencias
2. cp .env.example .env               → crea archivo de configuración
3. (editar .env)                      → configura rutas y workers
4. npm run test:models                → verifica que los modelos de IA cargan
5. npm run test:core                  → verifica el motor de análisis
6. npm run pipeline -- run --year N   → procesa el festival
7. npm run pipeline -- retry --year N → reintenta los fallidos
8. npm run pipeline -- validate       → revisa la calidad del resultado
9. npm run pipeline -- enrich ...     → (opcional) agrega datos de Spotify
```

---

## Referencia rápida de comandos

| Comando | Descripción |
|---------|-------------|
| `npm run pipeline -- run --year 2013` | Descargar + analizar una edición |
| `npm run pipeline -- run --all` | Todas las ediciones en `CSV_DIR` |
| `npm run pipeline -- download --year 2013` | Solo descargar audios |
| `npm run pipeline -- analyze --year 2013` | Solo analizar (si ya tienes los WAV) |
| `npm run pipeline -- retry --year 2013` | Reintentar canciones fallidas |
| `npm run pipeline -- status --year 2013` | Ver progreso |
| `npm run pipeline -- status --year 2013 --watch 10` | Monitor en vivo (cada 10 s) |
| `npm run pipeline -- validate --year 2013` | Reporte de calidad |
| `npm run pipeline -- enrich --year 2013` | Enriquecer con Spotify |

### Opciones útiles para `run`

| Opción | Descripción |
|--------|-------------|
| `--year 2013` | Una edición |
| `--years 2013,2014` | Varias ediciones |
| `--all` | Todas las ediciones |
| `--csv RUTA` | Ruta al CSV de entrada |
| `--output-dir RUTA` | Carpeta de salida |
| `--download-workers N` | Descargas simultáneas (recomendado: 3–4) |
| `--analyze-workers N` | Análisis simultáneos (recomendado: 2–3) |
| `--delete-wav-after` | Borra los WAV al terminar (ahorra ~30–50 GB por edición) |
| `--no-skip-existing` | Reprocesa canciones que ya tienen JSON |

---

## Solución de problemas frecuentes

### "command not found: node"
Node.js no está en el PATH. Ejecuta:
```bash
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```
Luego cierra y vuelve a abrir Terminal.

### "command not found: yt-dlp"
```bash
pip3 install yt-dlp
# o con Homebrew:
brew install yt-dlp
```

### "command not found: ffmpeg"
```bash
brew install ffmpeg
```

### YouTube bloquea las descargas
YouTube puede bloquear temporalmente la IP con muchas descargas simultáneas. Soluciones:
1. Reduce `DOWNLOAD_WORKERS` a `2` en `.env`.
2. Espera 30 minutos y vuelve a ejecutar (el pipeline retoma donde quedó).
3. Usa cookies de tu navegador para las descargas. Agrega esto en `.env`:
   ```env
   YTDLP_COOKIES_FROM_BROWSER=safari
   ```
   Valores posibles: `safari`, `chrome`, `firefox`.

### El Mac se pone lento durante el análisis
Cada worker de análisis consume ~200 MB de RAM. Reduce a:
```env
ANALYZE_WORKERS=1
```

### Los modelos no cargan (test:models falla)
Verifica que la carpeta `models/` dentro del proyecto no esté vacía:
```bash
ls models/
```
Debe mostrar 4 carpetas: `mood_happy-musicnn`, `mood_relaxed-musicnn`, `mood_aggressive-musicnn`, `danceability-musicnn`.

---

## Archivos generados

| Archivo/Carpeta | Descripción |
|-----------------|-------------|
| `data/output/DATA_{año}/` | JSONs de salida, uno por canción |
| `progress/{año}.json` | Estado de progreso (permite reanudar) |
| `reports/quality_{año}.json` | Reporte de calidad tras `validate` |
| `downloads/{año}/` | Audios WAV temporales (se pueden borrar al terminar) |

---

## Rendimiento esperado

| Escenario | Tiempo aproximado |
|-----------|------------------|
| 1 edición (~262 canciones) con workers dl:4, an:2 | **1–3 horas** |
| 1 edición con 1 worker | 4–8 horas |
| 15 ediciones (~3.900 canciones) con workers | 1–2 días |

> El tiempo real depende de la velocidad de internet y del procesador. El cuello de botella es la descarga de YouTube (~70% del tiempo total). Aumentar `--download-workers` es la optimización más efectiva, hasta un máximo de 4 antes de arriesgarse a bloqueos de IP.

---

*Manual de usuario — Audio DNA Pipeline v0.1.0*
