const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createPKCE, validateCallback, SCOPES } = require('../src/lib/auth.cjs');
const { SpotifyClient } = require('../src/lib/spotify.cjs');
const { Storage } = require('../src/lib/storage.cjs');
const { restoreBounds, snapToBounds } = require('../src/lib/window-state.cjs');

const trackUri = 'spotify:track:1234567890123456789012';
const session = { clientId: 'a'.repeat(32), accessToken: 'access', refreshToken: 'refresh', expiresAt: 1000000 };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
function clientWith(fetchImpl, extra = {}) {
  const client = new SpotifyClient({ fetchImpl, now: () => 0, ...extra });
  client.restore({ ...session });
  return client;
}

test('PKCE generates high-entropy URL-safe verifiers and correct S256 challenges', () => {
  const first = createPKCE();
  assert.match(first.verifier, /^[\w-]{43,128}$/);
  assert.equal(first.challenge, createHash('sha256').update(first.verifier).digest('base64url'));
  assert.notEqual(first.verifier, createPKCE().verifier);
});

test('OAuth callback rejects wrong paths, missing state, and mismatched state', () => {
  const callback = query => validateCallback(new URL(`http://127.0.0.1:43827${query}`), 'expected');
  assert.equal(callback('/favicon.ico').status, 404);
  assert.equal(callback('/callback?code=test').status, 400);
  assert.equal(callback('/callback?code=test&state=wrong').status, 400);
  assert.equal(callback('/callback?code=test&state=expectee').status, 400);
  assert.equal(callback('/callback?state=expected').status, 400);
  assert.equal(callback('/callback?code=test&state=expected').code, 'test');
  assert.match(callback('/callback?error=access_denied&state=expected').error, /declined/);
});

test('search escapes query strings and respects the development-mode page size', async () => {
  let request;
  const client = clientWith(async (url, init) => { request = { url: new URL(url), init }; return json({ tracks: { items: [] } }); });
  await client.action('search', { query: 'a & b #c', offset: 10 });
  assert.equal(request.url.searchParams.get('q'), 'a & b #c');
  assert.equal(request.url.searchParams.get('limit'), '10');
  assert.equal(request.url.searchParams.get('offset'), '10');
  assert.equal(request.init.headers.Authorization, 'Bearer access');
});

test('track playback and context playback use distinct Spotify bodies', async () => {
  const requests = [];
  const client = clientWith(async (_url, init) => { requests.push(init); return new Response(null, { status: 204 }); });
  await client.action('play', { uri: trackUri });
  await client.action('play', { uri: trackUri.replace('track', 'album') });
  await client.action('play');
  await client.action('play', { uri: trackUri, contextUri: trackUri.replace('track', 'album') });
  assert.deepEqual(JSON.parse(requests[0].body), { uris: [trackUri] });
  assert.deepEqual(JSON.parse(requests[1].body), { context_uri: trackUri.replace('track', 'album') });
  assert.equal(requests[2].body, undefined);
  assert.deepEqual(JSON.parse(requests[3].body), {
    context_uri: trackUri.replace('track', 'album'),
    offset: { uri: trackUri },
  });
});

test('library writes use current generic endpoints with URI parameters', async () => {
  const requests = [];
  const client = clientWith(async (url, init) => { requests.push({ url: new URL(url), method: init.method }); return new Response(null, { status: 200 }); });
  await client.action('save', { uri: trackUri });
  await client.action('unsave', { uri: trackUri });
  assert.equal(requests[0].url.pathname, '/v1/me/library');
  assert.equal(requests[0].url.searchParams.get('uris'), trackUri);
  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[1].method, 'DELETE');
});

test('successful playback and library controls accept non-JSON response bodies without retrying', async () => {
  const controls = [
    ['play', { uri: trackUri }], ['pause', {}], ['next', {}], ['previous', {}],
    ['seek', { position: 1000 }], ['volume', { volume: 50 }],
    ['shuffle', { enabled: true }], ['repeat', { mode: 'context' }],
    ['transfer', { deviceId: 'test-device' }], ['enqueue', { uri: trackUri }],
    ['save', { uri: trackUri }], ['unsave', { uri: trackUri }],
  ];
  let calls = 0;
  const client = clientWith(async () => {
    calls++;
    return new Response(calls % 2 ? 'B-demo-command-receipt' : 'E-demo-command-receipt', {
      status: 200, headers: { 'Content-Type': 'text/plain' },
    });
  });
  for (const [name, args] of controls) assert.equal(await client.action(name, args), null);
  assert.equal(calls, controls.length);
});

test('malformed data responses report the endpoint without exposing response contents', async () => {
  const rawBody = 'synthetic-private-response';
  const client = clientWith(async () => new Response(rawBody, { status: 200 }));
  await assert.rejects(client.action('playback'), error => {
    assert.equal(error.name, 'Error');
    assert.match(error.message, /unreadable response.*GET \/me\/player/);
    assert.equal(error.message.includes(rawBody), false);
    assert.equal(error.message.includes('Unexpected token'), false);
    return true;
  });
});

test('valid JSON data still parses and unsuccessful controls still fail', async () => {
  const client = clientWith(async () => json({ devices: [{ id: 'test-device' }] }));
  assert.deepEqual(await client.action('devices'), { devices: [{ id: 'test-device' }] });
  client.fetch = async () => new Response('Forbidden', { status: 403 });
  await assert.rejects(client.action('save', { uri: trackUri }), error => error.status === 403);
});

test('invalid IPC arguments cannot trigger network calls', async () => {
  const client = clientWith(() => { throw new Error('Network should not be called'); });
  for (const [name, args] of [
    ['volume', { volume: 101 }], ['volume', { volume: '50' }], ['seek', { position: -1 }],
    ['search', { query: 'x', type: 'invalid' }], ['shuffle', { enabled: 'true' }],
    ['repeat', { mode: 'anything' }], ['play', { uri: 'https://evil.invalid' }],
    ['enqueue', { uri: trackUri.replace('track', 'playlist') }], ['transfer', {}], ['unknown', {}],
  ]) await assert.rejects(client.action(name, args), /Invalid|Unknown/);
});

test('expired tokens refresh once for concurrent requests and preserve refresh token', async () => {
  let refreshes = 0;
  let saved;
  const client = clientWith(async (url, init) => {
    if (url.includes('/api/token')) { refreshes++; await new Promise(r => setTimeout(r, 5)); return json({ access_token: 'renewed', expires_in: 3600 }); }
    assert.equal(init.headers.Authorization, 'Bearer renewed');
    return json({ devices: [] });
  }, { saveSession: async value => { saved = value; } });
  client.restore({ ...session, expiresAt: 0 });
  await Promise.all([client.action('devices'), client.action('devices'), client.action('queue')]);
  assert.equal(refreshes, 1);
  assert.equal(saved.refreshToken, session.refreshToken);
});

test('a 401 refreshes and retries exactly once', async () => {
  let apiCalls = 0;
  let refreshes = 0;
  const client = clientWith(async url => {
    if (url.includes('/api/token')) { refreshes++; return json({ access_token: 'new', expires_in: 3600 }); }
    apiCalls++;
    return json({ error: 'unauthorized' }, 401);
  });
  await assert.rejects(client.action('devices'), /Reconnect/);
  assert.equal(apiCalls, 2);
  assert.equal(refreshes, 1);
});

test('rate limits block all API calls until Retry-After has passed', async () => {
  let now = 0;
  let calls = 0;
  const client = clientWith(async () => {
    calls++;
    return calls === 1 ? json({}, 429, { 'Retry-After': '60' }) : json({ devices: [] });
  }, { now: () => now });
  await assert.rejects(client.action('devices'), error => error.status === 429 && error.retryAfter === 60);
  await assert.rejects(client.action('queue'), error => error.status === 429);
  assert.equal(calls, 1);
  now = 60001;
  await client.action('devices');
  assert.equal(calls, 2);
});

test('logout during token refresh cannot recreate the session', async () => {
  let release;
  const saves = [];
  const client = clientWith(() => new Promise(resolve => { release = resolve; }), { saveSession: async value => saves.push(value) });
  client.restore({ ...session, expiresAt: 0 });
  const pending = client.action('devices');
  await client.disconnect();
  release(json({ access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600 }));
  await assert.rejects(pending, /disconnected/);
  assert.equal(client.connected, false);
  assert.deepEqual(saves, [null]);
});

test('revoked refresh tokens clear the saved connection', async () => {
  let saved = 'unchanged';
  const client = clientWith(async () => json({ error: 'invalid_grant' }, 400), { saveSession: async value => { saved = value; } });
  client.restore({ ...session, expiresAt: 0 });
  await assert.rejects(client.action('devices'), /expired/);
  assert.equal(saved, null);
  assert.equal(client.connected, false);
});

test('no playback is a normal 204 state, and no device gives an actionable error', async () => {
  const client = clientWith(async () => new Response(null, { status: 204 }));
  assert.equal(await client.action('playback'), null);
  client.fetch = async () => json({}, 404);
  await assert.rejects(client.action('play'), /Open Spotify/);
});

test('network failures are reported without leaking tokens', async () => {
  const client = clientWith(async () => { throw new Error('private network details'); });
  await assert.rejects(client.action('playback'), error => /internet connection/.test(error.message) && !error.message.includes('private'));
});

test('window bounds recover from a disconnected display and support negative coordinates', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: 0, width: 1280, height: 720 }];
  assert.deepEqual(restoreBounds({ x: 3000, y: 2000, width: 420, height: 540 }, [screens[0]]), { x: 1500, y: 500, width: 420, height: 540 });
  assert.deepEqual(restoreBounds({ x: -1000, y: 10, width: 420, height: 540 }, screens), { x: -1000, y: 10, width: 420, height: 540 });
  assert.equal(restoreBounds(null, screens, true).height, 200);
  assert.deepEqual(restoreBounds({ x: 'bad', y: null, width: -1, height: 0 }, screens), restoreBounds(null, screens));
});

test('snapToBounds snaps window magnetically within threshold of screen edges', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.equal(snapToBounds({ x: 12, y: 100, width: 400, height: 500 }, workArea, 20).x, 0);
  assert.equal(snapToBounds({ x: 35, y: 100, width: 400, height: 500 }, workArea, 20).x, 35);
  assert.equal(snapToBounds({ x: 1510, y: 100, width: 400, height: 500 }, workArea, 20).x, 1520);
  assert.equal(snapToBounds({ x: 100, y: 535, width: 400, height: 500 }, workArea, 20).y, 540);
  assert.equal(snapToBounds({ x: 100, y: 10, width: 400, height: 500 }, workArea, 20).y, 0);
});

test('session storage refuses Linux plaintext fallback and removes old credentials', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pocket-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new Storage(directory, {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'basic_text',
    encryptStringAsync: () => { throw new Error('Must not encrypt with plaintext fallback'); },
  }, 'linux');
  await storage.initialize();
  await storage.saveSession(session);
  assert.equal(storage.persistent, false);
  assert.deepEqual(await readdir(directory), []);
});

test('session saves and logout are serialized, and settings exclude credentials', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pocket-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new Storage(directory, {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => { await new Promise(r => setTimeout(r, 10)); return Buffer.from('encrypted'); },
  }, 'win32');
  await storage.initialize();
  await Promise.all([storage.saveSession(session), storage.saveSession(null)]);
  assert.deepEqual(await readdir(directory), []);
  await storage.saveSettings({ pinned: true });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'settings.json'))), { pinned: true });
});

test('demo supports search, queue, saving songs, playback, and device transfer without a network', async () => {
  const { DemoPlayer } = await import(pathToFileURL(path.join(__dirname, '../src/renderer/demo.js')));
  const demo = new DemoPlayer();
  const search = await demo.action('search', { query: 'soft focus', type: 'track' });
  assert.equal(search.tracks.items.length, 1);
  const uri = search.tracks.items[0].uri;
  await demo.action('pause');
  assert.equal((await demo.action('playback')).is_playing, false);
  await demo.action('unsave', { uri });
  assert.deepEqual(await demo.action('saved', { uri }), [false]);
  await demo.action('enqueue', { uri });
  assert.equal((await demo.action('queue')).queue.at(-1).uri, uri);
  await demo.action('transfer', { deviceId: 'demo-speaker' });
  assert.equal((await demo.action('playback')).device.name, 'Living room');
  await demo.action('play', { uri });
  assert.equal((await demo.action('playback')).is_playing, true);

  // New demo features
  const profile = await demo.action('profile');
  assert.equal(profile.product, 'premium');
  const feat = await demo.action('audio-features', { id: uri.split(':').pop() });
  assert.equal(typeof feat.tempo, 'number');
  assert.equal(typeof feat.valence, 'number');
  const recent = await demo.action('recently-played');
  assert.ok(recent.items.length > 0);
  const top = await demo.action('top-tracks');
  assert.ok(top.items.length > 0);
  const recs = await demo.action('recommendations', { seedTracks: '123' });
  assert.ok(recs.tracks.length > 0);
  const albums = await demo.action('albums');
  assert.ok(albums.items.length > 0);
});

test('SCOPES includes discovery, profile, and following permissions', () => {
  assert.ok(SCOPES.includes('user-read-recently-played'));
  assert.ok(SCOPES.includes('user-top-read'));
  assert.ok(SCOPES.includes('user-follow-read'));
  assert.ok(SCOPES.includes('user-read-private'));
});

test('expanded Spotify API actions query expected endpoints and parameters', async () => {
  const requests = [];
  const client = clientWith(async (url, init) => {
    requests.push({ url: new URL(url), method: init.method });
    return json({ ok: true });
  });

  const testId = '1234567890123456789012';
  await client.action('profile');
  assert.equal(requests[0].url.pathname, '/v1/me');

  await client.action('audio-features', { id: testId });
  assert.equal(requests[1].url.pathname, `/v1/audio-features/${testId}`);

  await client.action('recently-played', { limit: 25 });
  assert.equal(requests[2].url.pathname, '/v1/me/player/recently-played');
  assert.equal(requests[2].url.searchParams.get('limit'), '25');

  await client.action('top-tracks', { timeRange: 'short_term', limit: 15 });
  assert.equal(requests[3].url.pathname, '/v1/me/top/tracks');
  assert.equal(requests[3].url.searchParams.get('time_range'), 'short_term');
  assert.equal(requests[3].url.searchParams.get('limit'), '15');

  await client.action('top-artists', { timeRange: 'long_term', limit: 10 });
  assert.equal(requests[4].url.pathname, '/v1/me/top/artists');
  assert.equal(requests[4].url.searchParams.get('time_range'), 'long_term');

  await client.action('recommendations', { seedTracks: testId, limit: 20 });
  assert.equal(requests[5].url.pathname, '/v1/recommendations');
  assert.equal(requests[5].url.searchParams.get('seed_tracks'), testId);

  await client.action('album-tracks', { id: testId, limit: 30 });
  assert.equal(requests[6].url.pathname, `/v1/albums/${testId}/tracks`);
  assert.equal(requests[6].url.searchParams.get('limit'), '30');

  await client.action('artist-top-tracks', { id: testId });
  assert.equal(requests[7].url.pathname, `/v1/artists/${testId}/top-tracks`);
  assert.equal(requests[7].url.searchParams.get('market'), 'from_token');

  await client.action('albums', { offset: 20 });
  assert.equal(requests[8].url.pathname, '/v1/me/albums');
  assert.equal(requests[8].url.searchParams.get('offset'), '20');

  await client.action('following');
  assert.equal(requests[9].url.pathname, '/v1/me/following');
  assert.equal(requests[9].url.searchParams.get('type'), 'artist');
});

test('invalid arguments for audio-features, top items, and recommendations reject safely', async () => {
  const client = clientWith(() => { throw new Error('Network should not be called'); });
  await assert.rejects(client.action('audio-features', { id: 'too-short' }));
  await assert.rejects(client.action('top-tracks', { timeRange: 'century_term' }));
  await assert.rejects(client.action('recommendations', { limit: 500 }));
  await assert.rejects(client.action('album-tracks', { id: 'invalid!' }));
});

test('audio-features falls back to open provider when Spotify returns 403 Forbidden', async () => {
  const requests = [];
  const client = clientWith(async (url, init) => {
    requests.push({ url: new URL(url), method: init?.method || 'GET' });
    if (url.includes('api.spotify.com')) {
      return new Response(JSON.stringify({ error: { status: 403, message: 'Forbidden' } }), { status: 403 });
    }
    if (url.includes('api.reccobeats.com')) {
      return json({
        content: [{
          id: 'test',
          tempo: 128.5,
          key: 5,
          mode: 1,
          valence: 0.75,
          energy: 0.8,
          danceability: 0.65,
        }],
      });
    }
    return new Response('Not found', { status: 404 });
  });

  const feat = await client.action('audio-features', { id: '1234567890123456789012' });
  assert.equal(feat.tempo, 128.5);
  assert.equal(feat.key, 5);
  assert.equal(feat.mode, 1);
  assert.equal(feat.valence, 0.75);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, '/v1/audio-features/1234567890123456789012');
  assert.equal(requests[1].url.hostname, 'api.reccobeats.com');

  // Subsequent call for same ID should hit the in-memory cache
  const cached = await client.action('audio-features', { id: '1234567890123456789012' });
  assert.equal(cached.tempo, 128.5);
  assert.equal(requests.length, 2);
});
