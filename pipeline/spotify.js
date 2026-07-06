/**
 * pipeline/spotify.js
 * Cliente Spotify Web API (Client Credentials Flow)
 *
 * Requiere en .env:
 *   SPOTIFY_CLIENT_ID=...
 *   SPOTIFY_CLIENT_SECRET=...
 *
 * No necesita dependencias externas; usa fetch nativo de Node 20+.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE  = 'https://api.spotify.com/v1';

// ─── Token cache ──────────────────────────────────────────────────────────────

let _cache = null;

async function getToken() {
  if (_cache && _cache.expiresAt > Date.now() + 60_000) return _cache.token;

  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!id || !secret) {
    throw new Error(
      'Faltan credenciales Spotify. Define SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en .env'
    );
  }

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify auth falló (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  _cache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _cache.token;
}

// ─── HTTP helper con retry en 429 ────────────────────────────────────────────

async function get(path, maxRetries = 3) {
  const token = await getToken();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      const wait = (parseInt(res.headers.get('Retry-After') || '1', 10) + 1) * 1000;
      if (attempt < maxRetries) { await sleep(wait); continue; }
    }

    if (!res.ok) throw new Error(`Spotify ${path} → HTTP ${res.status}`);
    return res.json();
  }
}

// ─── Normalización para match confidence ─────────────────────────────────────

function norm(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(expected, actual) {
  const a = norm(expected);
  const b = norm(actual);
  if (!a || !b)             return 0;
  if (a === b)              return 100;
  if (a.includes(b) || b.includes(a)) return 88;

  const wa = new Set(a.split(' '));
  const wb = new Set(b.split(' '));
  const common = [...wa].filter(w => w.length > 1 && wb.has(w)).length;
  const total  = Math.max(wa.size, wb.size, 1);
  return Math.round((common / total) * 70);
}

// ─── Derivación de género ─────────────────────────────────────────────────────

const GENRE_RULES = [
  { genre: 'Metal',        keywords: ['metal', 'hardcore', 'deathcore', 'thrash', 'doom', 'sludge', 'stoner'] },
  { genre: 'Rock',         keywords: ['rock', 'punk', 'grunge', 'post-punk', 'shoegaze', 'noise', 'garage', 'emo'] },
  { genre: 'Electrónica',  keywords: ['electronic', 'edm', 'techno', 'house', 'trance', 'ambient', 'electro',
                                       'synth', 'idm', 'downtempo', 'drum and bass', 'dubstep', 'chillwave', 'witch house'] },
  { genre: 'Hip-Hop/Rap',  keywords: ['hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'grime', 'boom bap'] },
  { genre: 'Pop',          keywords: ['pop', 'dance pop', 'electropop', 'indie pop', 'teen pop', 'bubblegum'] },
  { genre: 'Jazz',         keywords: ['jazz', 'bebop', 'swing', 'fusion', 'bossa nova', 'cool jazz'] },
  { genre: 'Clásica',      keywords: ['classical', 'orchestra', 'chamber', 'opera', 'baroque', 'symphon', 'neoclassical'] },
  { genre: 'Latin',        keywords: ['latin', 'reggaeton', 'cumbia', 'salsa', 'vallenato', 'colombian',
                                       'mexican', 'spanish', 'flamenco', 'bachata', 'merengue', 'tropical'] },
  { genre: 'R&B/Soul',     keywords: ['r&b', 'soul', 'funk', 'neo soul', 'gospel', 'motown'] },
  { genre: 'Folk/Indie',   keywords: ['folk', 'indie', 'singer-songwriter', 'acoustic', 'americana', 'bluegrass', 'country'] },
  { genre: 'Reggae',       keywords: ['reggae', 'ska', 'dub', 'dancehall', 'roots reggae'] },
];

export function deriveGenre(spotifyGenres = []) {
  if (!spotifyGenres.length) return { genre: '', subgenre: '', explanation: '', confidence: 0 };

  const joined = spotifyGenres.join(' ').toLowerCase();

  for (const rule of GENRE_RULES) {
    const matched = rule.keywords.find(k => joined.includes(k));
    if (matched) {
      // Subgénero: el tag más específico de Spotify que disparó la regla
      const subTag = spotifyGenres.find(g => g.toLowerCase().includes(matched)) || '';
      return {
        genre:       rule.genre,
        subgenre:    subTag,
        explanation: `Derivado de tags Spotify: ${spotifyGenres.slice(0, 3).join(', ')}`,
        confidence:  80,
      };
    }
  }

  // Sin match — devolver el primer tag crudo como subgénero
  return {
    genre:       'Otro',
    subgenre:    spotifyGenres[0] || '',
    explanation: `Tags Spotify sin clasificar: ${spotifyGenres.slice(0, 3).join(', ')}`,
    confidence:  40,
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Busca una canción en Spotify y devuelve los campos de enriquecimiento.
 *
 * @param {string} artist
 * @param {string} trackName
 * @returns {Promise<object|null>}  null si no se encontró con confianza suficiente
 */
export async function enrichTrack(artist, trackName) {
  const q    = encodeURIComponent(`${artist} ${trackName}`);
  const data = await get(`/search?q=${q}&type=track&limit=5&market=US`);

  const items = data?.tracks?.items ?? [];
  if (!items.length) return null;

  // Elegir el resultado con mayor combined score
  let best = null, bestScore = 0;

  for (const item of items) {
    const ts = score(trackName, item.name);
    const as = score(artist,    item.artists[0]?.name ?? '');
    const combined = Math.round(ts * 0.6 + as * 0.4);
    if (combined > bestScore) { bestScore = combined; best = item; }
  }

  if (!best || bestScore < 25) return null;

  // Obtener géneros del artista principal (request separado)
  let genres = [];
  const artistId = best.artists[0]?.id;
  if (artistId) {
    try {
      const artistData = await get(`/artists/${artistId}`);
      genres = artistData.genres ?? [];
    } catch { /* géneros son opcionales */ }
  }

  const albumArt = best.album?.images?.[0]?.url ?? null;

  return {
    spotifyTrackName:       best.name,
    spotifyArtist:          best.artists.map(a => a.name).join(', '),
    spotifyAlbumArt:        albumArt,
    spotifyGenres:          genres,
    spotifyMatchConfidence: bestScore,
    spotifyId:              best.id,
  };
}

/**
 * Verifica que las credenciales funcionen.
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function pingSpotify() {
  try {
    await get('/search?q=test&type=track&limit=1');
    return { ok: true, message: 'Credenciales Spotify válidas.' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
