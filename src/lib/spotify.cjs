const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const { logger } = require('./logger.cjs');

class SpotifyError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

class SpotifyClient {
  constructor({ fetchImpl = fetch, saveSession = async () => {}, now = Date.now } = {}) {
    this.fetch = fetchImpl;
    this.saveSession = saveSession;
    this.now = now;
    this.session = null;
    this.refreshing = null;
    this.generation = 0;
    this.blockedUntil = 0;
    this.audioFeaturesCache = new Map();
  }

  restore(session) {
    if (session?.clientId && session?.refreshToken) this.session = session;
  }

  get connected() { return Boolean(this.session); }

  async disconnect() {
    this.generation++;
    this.session = null;
    this.refreshing = null;
    this.blockedUntil = 0;
    this.audioFeaturesCache.clear();
    await this.saveSession(null);
  }

  async tokenRequest(params) {
    let response;
    try {
      response = await this.fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params), signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new SpotifyError('Could not reach Spotify. Check your connection and try again.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new SpotifyError(response.status === 400 || response.status === 401
        ? 'Spotify sign-in expired or the Client ID is incorrect. Connect again.'
        : 'Spotify sign-in is temporarily unavailable. Try again shortly.', response.status);
    }
    if (!data.access_token || !Number.isFinite(data.expires_in)) throw new SpotifyError('Spotify returned an invalid session.');
    return data;
  }

  async connect(clientId, { code, verifier, redirectUri }) {
    const generation = this.generation;
    const data = await this.tokenRequest({
      client_id: clientId, grant_type: 'authorization_code', code,
      redirect_uri: redirectUri, code_verifier: verifier,
    });
    if (generation !== this.generation) throw new SpotifyError('Sign-in canceled.');
    if (!data.refresh_token) throw new SpotifyError('Spotify did not return a refresh token. Please reconnect.');
    this.session = {
      clientId, accessToken: data.access_token, refreshToken: data.refresh_token,
      expiresAt: this.now() + data.expires_in * 1000,
    };
    await this.saveSession(this.session);
  }

  async token(force = false) {
    if (!this.session) throw new SpotifyError('Connect your Spotify account in Settings.', 401);
    if (!force && this.session.accessToken && this.session.expiresAt > this.now() + 60_000) return this.session.accessToken;
    if (!this.refreshing) {
      const generation = this.generation;
      const session = this.session;
      const refresh = (async () => {
        let data;
        try {
          data = await this.tokenRequest({
            client_id: session.clientId, grant_type: 'refresh_token', refresh_token: session.refreshToken,
          });
        } catch (error) {
          if (generation === this.generation && [400, 401].includes(error.status)) await this.disconnect();
          throw error;
        }
        if (generation !== this.generation) throw new SpotifyError('Spotify was disconnected.', 401);
        this.session = {
          ...session, accessToken: data.access_token,
          refreshToken: data.refresh_token || session.refreshToken,
          expiresAt: this.now() + data.expires_in * 1000,
        };
        await this.saveSession(this.session);
        return this.session.accessToken;
      })();
      this.refreshing = refresh;
      refresh.finally(() => { if (this.refreshing === refresh) this.refreshing = null; }).catch(() => {});
    }
    return this.refreshing;
  }

  async request(path, { method = 'GET', query = {}, body } = {}, retried = false) {
    if (this.blockedUntil > this.now()) {
      const seconds = Math.ceil((this.blockedUntil - this.now()) / 1000);
      throw new SpotifyError(`Spotify is busy. Try again in ${seconds}s.`, 429, seconds);
    }
    const accessToken = await this.token();
    const generation = this.generation;
    const url = new URL(`${API}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    logger.debug('Spotify:Req', `${method} ${path}`, { query, body });
    let response;
    try {
      response = await this.fetch(url.href, {
        method, headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new SpotifyError('Could not reach Spotify. Check your internet connection.'); }
    if (generation !== this.generation) throw new SpotifyError('Spotify was disconnected.', 401);
    if (response.status === 401 && !retried) {
      // Another request may already have refreshed this same rejected token.
      if (this.session?.accessToken === accessToken) await this.token(true);
      return this.request(path, { method, query, body }, true);
    }
    if (response.status === 429) {
      const value = Number(response.headers.get('retry-after'));
      const seconds = Number.isFinite(value) && value > 0 ? Math.ceil(value) : 30;
      this.blockedUntil = this.now() + seconds * 1000;
      throw new SpotifyError(`Spotify's request limit was reached. Try again in ${seconds}s.`, 429, seconds);
    }
    if (!response.ok) {
      let detail = '';
      try {
        const text = await response.text();
        if (text && text.trim().startsWith('{')) {
          const parsed = JSON.parse(text);
          if (parsed?.error?.message) {
            detail = parsed.error.message;
            if (parsed.error.reason) detail += ` [${parsed.error.reason}]`;
          }
        }
      } catch {}

      const messages = {
        401: 'Spotify could not authorize this request. Reconnect in Settings.',
        403: 'Spotify denied this action. Check Premium, app access, and device restrictions.',
        404: 'No active Spotify device. Open Spotify, play a song, then choose a device.',
      };
      const message = detail
        ? `Spotify: ${detail}`
        : (messages[response.status] || `Spotify could not complete this action (${response.status}).`);

      const isExpectedFallback = (path.startsWith('/audio-features') && [403, 404].includes(response.status))
        || (path.startsWith('/recommendations') && [403, 404].includes(response.status));

      if (isExpectedFallback) {
        logger.debug('Spotify', `${method} ${path} -> HTTP ${response.status} (attempting open fallback)`);
      } else {
        logger.error('Spotify', `${method} ${path} -> HTTP ${response.status}: ${message}`);
      }
      throw new SpotifyError(message, response.status);
    }
    logger.debug('Spotify:Res', `${method} ${path} -> HTTP ${response.status}`);
    if (response.status === 204) return null;
    // Every mutation exposed by action() is a playback or library command with
    // no response data to consume. A successful status is sufficient; Spotify
    // can include a plain-text receipt that must not be parsed or trigger a retry.
    if (method !== 'GET') {
      try { await response.body?.cancel(); } catch { /* The command already succeeded. */ }
      return null;
    }
    try {
      const text = await response.text();
      return text.trim() ? JSON.parse(text) : null;
    } catch {
      // SyntaxError messages can include raw response contents. Keep diagnostics
      // useful without exposing response bodies or authentication information.
      throw new SpotifyError(`Spotify returned an unreadable response for ${method} ${path} (HTTP ${response.status}). Please try again.`, response.status);
    }
  }

  async action(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid request.');
    const device = args.deviceId === undefined ? undefined : string(args.deviceId, 256);
    const query = { device_id: device };
    switch (name) {
      case 'playback': return this.request('/me/player');
      case 'devices': return this.request('/me/player/devices');
      case 'queue': return this.request('/me/player/queue');
      case 'search': {
        const type = choice(args.type || 'track', ['track', 'album', 'artist', 'playlist']);
        return this.request('/search', { query: { q: string(args.query, 200), type, limit: 10, offset: integer(args.offset ?? 0, 0, 1000) } });
      }
      case 'library': return this.request('/me/tracks', { query: { limit: 20, offset: integer(args.offset ?? 0, 0, 100_000) } });
      case 'playlists': return this.request('/me/playlists', { query: { limit: 20, offset: integer(args.offset ?? 0, 0, 100_000) } });
      case 'albums': return this.request('/me/albums', { query: { limit: 20, offset: integer(args.offset ?? 0, 0, 100_000) } });
      case 'following': return this.request('/me/following', { query: { type: 'artist', limit: 20 } });
      case 'profile': return this.request('/me');
      case 'audio-features': {
        const id = spotifyId(args.id);
        if (this.audioFeaturesCache.has(id)) return this.audioFeaturesCache.get(id);
        let features = null;
        try {
          features = await this.request(`/audio-features/${id}`);
        } catch (error) {
          if ([403, 404].includes(error.status)) {
            logger.info('Spotify', `Spotify /audio-features returned ${error.status}; querying open fallback provider for ${id}`);
            try {
              const res = await this.fetch(`https://api.reccobeats.com/v1/audio-features?ids=${id}`, {
                signal: AbortSignal.timeout(4000),
              });
              if (res.ok) {
                const data = await res.json();
                const item = Array.isArray(data) ? data[0] : (data.content?.[0] || data);
                if (item && item.tempo) {
                  features = {
                    id,
                    tempo: Number(item.tempo),
                    key: Number(item.key),
                    mode: Number(item.mode),
                    valence: Number(item.valence),
                    energy: Number(item.energy),
                    danceability: Number(item.danceability),
                  };
                }
              }
            } catch (fallbackError) {
              logger.debug('Spotify', 'Open audio-features fallback failed:', fallbackError.message);
            }

            if (!features) {
              const queries = [id, `${args.artist || ''} ${args.title || ''}`.trim()].filter(Boolean);
              for (const q of queries) {
                try {
                  const res = await this.fetch('https://songbpm.com/searches', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    },
                    body: `query=${encodeURIComponent(q)}`,
                    signal: AbortSignal.timeout(4000),
                  });
                  if (!res.ok) continue;
                  const html = await res.text();
                  const bpmMatch = html.match(/<span[^>]*class="[^"]*uppercase[^"]*">BPM<\/span>\s*<span[^>]*>\s*([0-9]+)\s*<\/span>/i);
                  const keyMatch = html.match(/<span[^>]*class="[^"]*uppercase[^"]*">Key<\/span>\s*<span[^>]*>\s*([A-Ga-g][#b♭♯]?(?:\s*(?:maj|min|major|minor|m))?)\s*<\/span>/i);
                  if (bpmMatch) {
                    const bpm = Number(bpmMatch[1]);
                    features = {
                      id,
                      tempo: bpm,
                      keyText: keyMatch ? keyMatch[1].trim() : '',
                      valence: bpm > 130 ? 0.7 : 0.45,
                      energy: bpm > 120 ? 0.75 : 0.5,
                      danceability: 0.65,
                    };
                    break;
                  }
                } catch (songBpmErr) {
                  logger.debug('Spotify', 'SongBPM query failed:', songBpmErr.message);
                }
              }
            }
          }
          if (!features) return null;
        }
        if (features) {
          this.audioFeaturesCache.set(id, features);
          const keyStr = features.keyText || (features.key != null ? ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][features.key] : '—');
          logger.info('MusicInfo', `♫ ${args.title ? `"${args.title}"` : id} -> ${Math.round(features.tempo)} BPM · Key: ${keyStr}`);
          if (this.audioFeaturesCache.size > 200) {
            const firstKey = this.audioFeaturesCache.keys().next().value;
            this.audioFeaturesCache.delete(firstKey);
          }
        } else {
          this.audioFeaturesCache.set(id, null);
        }
        return features;
      }
      case 'recently-played': return this.request('/me/player/recently-played', { query: { limit: integer(args.limit ?? 20, 1, 50) } });
      case 'top-tracks': {
        const timeRange = choice(args.timeRange || 'medium_term', ['short_term', 'medium_term', 'long_term']);
        const query = { time_range: timeRange, limit: integer(args.limit ?? 20, 1, 50) };
        if (args.offset !== undefined) query.offset = integer(args.offset, 0, 1000);
        return this.request('/me/top/tracks', { query });
      }
      case 'top-artists': {
        const timeRange = choice(args.timeRange || 'medium_term', ['short_term', 'medium_term', 'long_term']);
        const query = { time_range: timeRange, limit: integer(args.limit ?? 20, 1, 50) };
        if (args.offset !== undefined) query.offset = integer(args.offset, 0, 1000);
        return this.request('/me/top/artists', { query });
      }
      case 'recommendations': {
        const query = { limit: integer(args.limit ?? 20, 1, 100) };
        if (args.seedTracks) query.seed_tracks = string(args.seedTracks, 256);
        if (args.seedArtists) query.seed_artists = string(args.seedArtists, 256);
        if (args.seedGenres) query.seed_genres = string(args.seedGenres, 256);
        try {
          return await this.request('/recommendations', { query });
        } catch (error) {
          if ([403, 404].includes(error.status) && args.seedArtists) {
            logger.info('Spotify', 'Recommendations restricted; tuning station from artist top tracks');
            try {
              const res = await this.request(`/artists/${spotifyId(args.seedArtists)}/top-tracks`, { query: { market: 'from_token' } });
              return { tracks: res?.tracks || [] };
            } catch {}
          }
          throw error;
        }
      }
      case 'album-tracks': return this.request(`/albums/${spotifyId(args.id)}/tracks`, { query: { limit: integer(args.limit ?? 50, 1, 50) } });
      case 'artist-top-tracks': return this.request(`/artists/${spotifyId(args.id)}/top-tracks`, { query: { market: 'from_token' } });
      case 'play': {
        let body;
        if (args.contextUri && args.uri) {
          const contextUri = spotifyUri(args.contextUri, ['album', 'artist', 'playlist']);
          const uri = spotifyUri(args.uri, ['track', 'episode']);
          body = { context_uri: contextUri, offset: { uri } };
        } else if (args.uri) {
          const uri = spotifyUri(args.uri);
          body = /^spotify:(track|episode):/.test(uri) ? { uris: [uri] } : { context_uri: uri };
        }
        return this.request('/me/player/play', { method: 'PUT', query, body });
      }
      case 'pause': return this.request('/me/player/pause', { method: 'PUT', query });
      case 'next': case 'previous': return this.request(`/me/player/${name}`, { method: 'POST', query });
      case 'seek': return this.request('/me/player/seek', { method: 'PUT', query: { ...query, position_ms: integer(args.position, 0, 86_400_000) } });
      case 'volume': return this.request('/me/player/volume', { method: 'PUT', query: { ...query, volume_percent: integer(args.volume, 0, 100) } });
      case 'shuffle': {
        if (typeof args.enabled !== 'boolean') throw new Error('Invalid shuffle value.');
        return this.request('/me/player/shuffle', { method: 'PUT', query: { ...query, state: args.enabled } });
      }
      case 'repeat': return this.request('/me/player/repeat', { method: 'PUT', query: { ...query, state: choice(args.mode, ['off', 'context', 'track']) } });
      case 'transfer': return this.request('/me/player', { method: 'PUT', body: { device_ids: [string(args.deviceId, 256)], play: false } });
      case 'enqueue': return this.request('/me/player/queue', { method: 'POST', query: { ...query, uri: spotifyUri(args.uri, ['track', 'episode']) } });
      case 'saved': return this.request('/me/library/contains', { query: { uris: spotifyUri(args.uri, ['track', 'episode']) } });
      case 'save': case 'unsave': return this.request('/me/library', { method: name === 'save' ? 'PUT' : 'DELETE', query: { uris: spotifyUri(args.uri, ['track', 'episode']) } });
      default: throw new Error('Unknown Spotify action.');
    }
  }
}

function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid numeric value.');
  return value;
}
function string(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid text value.');
  return value.trim();
}
function choice(value, values) {
  if (!values.includes(value)) throw new Error('Invalid option.');
  return value;
}
function spotifyUri(value, types = ['track', 'episode', 'album', 'artist', 'playlist']) {
  const match = typeof value === 'string' && /^spotify:([a-z]+):([a-zA-Z0-9]{22})$/.exec(value);
  if (!match || !types.includes(match[1])) throw new Error('Invalid Spotify item.');
  return value;
}
function spotifyId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{22}$/.test(value.trim())) throw new Error('Invalid Spotify item.');
  return value.trim();
}

module.exports = { SpotifyClient, SpotifyError };
