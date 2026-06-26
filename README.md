# Audio DNA Pipeline

Pipeline batch para automatizar el procesamiento de archivos del Festival Estéreo Picnic (FEP):

```
FEP_{year}.csv → descarga WAV → análisis Node.js → DATA_{year}/{id}.json
```

## Requisitos

- **Node.js** 20+
- **ffmpeg** — decodificar WAV a PCM 16 kHz mono
- **yt-dlp** — descarga desde YouTube

## Instalación

```bash
npm install
npm run setup:models
cp .env.example .env
npm run test:models
```

Usar **Node.js 20 LTS**. En Windows, `npm install` ejecuta `postinstall` para configurar `tfjs-node`. Si falla: `npm run setup:tfjs`.

## Estructura

```
├── core/           # dsp, calibración, analyzer
├── pipeline/       # download, analyze, validate, cli
├── models/         # Essentia TF.js (gitignored; ver setup:models)
├── scripts/        # setup y pruebas
├── downloads/      # WAV temporales (gitignored)
└── ...
```
