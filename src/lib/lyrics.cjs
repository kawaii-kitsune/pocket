/**
 * Open Synced Lyrics Client using LRCLIB (free, open source, no API key).
 * Parses LRC synchronized timestamps and returns scrollable line objects.
 */

const { logger } = require('./logger.cjs');

const lyricsCache = new Map();

function parseLrc(lrc) {
  if (!lrc || typeof lrc !== 'string') return [];
  const lines = lrc.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(timeRegex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3] ? parseFloat(`0.${match[3]}`) : 0;
      const time = minutes * 60 + seconds + ms;
      const text = match[4].trim();
      if (text) {
        result.push({ time, text });
      }
    } else if (!trimmed.startsWith('[')) {
      result.push({ time: null, text: trimmed });
    }
  }
  return result;
}

async function fetchLyrics({ trackName, artistName, albumName, duration, fetchImpl = fetch } = {}) {
  if (!trackName) return null;
  const cleanTrack = String(trackName).trim();
  const cleanArtist = artistName ? String(artistName).split(',')[0].trim() : '';
  const cacheKey = `${cleanArtist.toLowerCase()} - ${cleanTrack.toLowerCase()}`;

  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  const queryParams = new URLSearchParams({
    track_name: cleanTrack,
  });
  if (cleanArtist) queryParams.set('artist_name', cleanArtist);
  if (albumName) queryParams.set('album_name', String(albumName).trim());
  if (duration && Number.isFinite(duration)) queryParams.set('duration', Math.round(duration / 1000));

  const url = `https://lrclib.net/api/get?${queryParams.toString()}`;

  try {
    let res = await fetchImpl(url, {
      headers: { 'User-Agent': 'PocketSpotifyCompanion/0.1.0' },
      signal: AbortSignal.timeout(4500),
    });

    // If exact get returned 404, fallback to search query
    if (res.status === 404) {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTrack}`.trim())}`;
      res = await fetchImpl(searchUrl, {
        headers: { 'User-Agent': 'PocketSpotifyCompanion/0.1.0' },
        signal: AbortSignal.timeout(4500),
      });
      if (res.ok) {
        const items = await res.json();
        const best = Array.isArray(items) ? items[0] : null;
        if (best && (best.syncedLyrics || best.plainLyrics)) {
          const parsed = {
            id: best.id,
            trackName: best.trackName || cleanTrack,
            artistName: best.artistName || cleanArtist,
            synced: Boolean(best.syncedLyrics),
            lines: parseLrc(best.syncedLyrics || best.plainLyrics),
          };
          lyricsCache.set(cacheKey, parsed);
          logger.info('Lyrics', `Fetched lyrics for "${cleanTrack}" (${parsed.synced ? 'Synced' : 'Plain'})`);
          return parsed;
        }
      }
    }

    if (res.ok) {
      const data = await res.json();
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        const parsed = {
          id: data.id,
          trackName: data.trackName || cleanTrack,
          artistName: data.artistName || cleanArtist,
          synced: Boolean(data.syncedLyrics),
          lines: parseLrc(data.syncedLyrics || data.plainLyrics),
        };
        lyricsCache.set(cacheKey, parsed);
        logger.info('Lyrics', `Fetched lyrics for "${cleanTrack}" (${parsed.synced ? 'Synced' : 'Plain'})`);
        return parsed;
      }
    }
  } catch (err) {
    logger.debug('Lyrics', `Lookup failed for "${cleanTrack}":`, err.message);
  }

  lyricsCache.set(cacheKey, null);
  return null;
}

module.exports = {
  parseLrc,
  fetchLyrics,
  lyricsCache,
};
