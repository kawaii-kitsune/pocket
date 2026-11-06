const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LibrespotEngine } = require('../src/lib/librespot.cjs');

test('LibrespotEngine handles playback and device events', () => {
  const engine = new LibrespotEngine({ port: 3678, deviceName: 'Test Player' });
  const events = [];

  engine.on('active', active => events.push({ type: 'active', active }));
  engine.on('playback', p => events.push({ type: 'playback', p }));

  engine.handleEvent({ event: 'active' });
  assert.equal(engine.active, true);
  assert.equal(events[0].active, true);

  engine.handleEvent({
    event: 'playing',
    uri: 'spotify:track:123',
    name: 'Test Song',
    artist_names: ['Artist One'],
    album_name: 'Test Album',
    duration: 180000,
    position: 45000,
  });

  assert.equal(events[1].type, 'playback');
  assert.equal(events[1].p.name, 'Test Song');
  assert.equal(events[1].p.is_playing, true);
  assert.equal(events[1].p.artists[0].name, 'Artist One');

  engine.handleEvent({ event: 'inactive' });
  assert.equal(engine.active, false);

  engine.destroy();
  assert.equal(engine.running, false);
});
