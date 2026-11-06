const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, fetchLyrics, lyricsCache } = require('../src/lib/lyrics.cjs');

test('parseLrc parses timestamped lines into time and text objects', () => {
  const lrc = `
    [ti:Test Track]
    [ar:Test Artist]
    [00:12.50]Line one text
    [01:05.10]Line two text
    Plain line with no timestamp
  `;
  const parsed = parseLrc(lrc);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].time, 12.5);
  assert.equal(parsed[0].text, 'Line one text');
  assert.equal(parsed[1].time, 65.1);
  assert.equal(parsed[1].text, 'Line two text');
  assert.equal(parsed[2].time, null);
  assert.equal(parsed[2].text, 'Plain line with no timestamp');
});

test('fetchLyrics resolves synced lyrics and caches results', async () => {
  lyricsCache.clear();
  let calls = 0;
  const mockFetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      id: 99,
      trackName: 'Test Song',
      artistName: 'Test Artist',
      syncedLyrics: '[00:05.00]Hello world\n[00:10.00]Second line',
    }), { status: 200 });
  };

  const res = await fetchLyrics({ trackName: 'Test Song', artistName: 'Test Artist', fetchImpl: mockFetch });
  assert.ok(res);
  assert.equal(res.synced, true);
  assert.equal(res.lines.length, 2);
  assert.equal(res.lines[0].text, 'Hello world');
  assert.equal(calls, 1);

  // Cached call doesn't invoke fetch again
  const cached = await fetchLyrics({ trackName: 'Test Song', artistName: 'Test Artist', fetchImpl: mockFetch });
  assert.equal(cached.id, 99);
  assert.equal(calls, 1);
});

test('fetchLyrics falls back to search endpoint when direct get returns 404', async () => {
  lyricsCache.clear();
  const urls = [];
  const mockFetch = async url => {
    urls.push(url);
    if (url.includes('/api/get')) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(JSON.stringify([
      {
        id: 101,
        trackName: 'Search Hit Song',
        plainLyrics: 'Plain line 1\nPlain line 2',
      },
    ]), { status: 200 });
  };

  const res = await fetchLyrics({ trackName: 'Search Hit Song', artistName: 'Band', fetchImpl: mockFetch });
  assert.ok(res);
  assert.equal(res.synced, false);
  assert.equal(res.lines.length, 2);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes('/api/search'));
});
