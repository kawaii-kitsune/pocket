const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SoloistClient, toPlaybackShape } = require('../src/lib/soloist.cjs');

test('toPlaybackShape normalizes Soloist state to standard Pocket playback shape', () => {
  assert.equal(toPlaybackShape(null), null);
  assert.equal(toPlaybackShape(undefined), null);

  const rawState = {
    is_playing: true,
    position_ms: 15400,
    volume: 75,
    shuffle_state: true,
    repeat_context: true,
    repeat_track: false,
    device_name: 'Living Room Soloist',
    item: {
      id: '1234567890123456789012',
      uri: 'spotify:track:1234567890123456789012',
      name: 'Soloist Track',
      duration_ms: 210000,
      artists: [{ name: 'Soloist Artist' }],
      album: { name: 'Soloist Album', images: [{ url: 'https://art.jpg' }] },
    },
  };

  const normalized = toPlaybackShape(rawState);
  assert.equal(normalized.is_playing, true);
  assert.equal(normalized.progress_ms, 15400);
  assert.equal(normalized.shuffle_state, true);
  assert.equal(normalized.repeat_state, 'context');
  assert.equal(normalized.device.name, 'Living Room Soloist');
  assert.equal(normalized.device.volume_percent, 75);
  assert.equal(normalized.item.name, 'Soloist Track');
  assert.equal(normalized.item.artists[0].name, 'Soloist Artist');
  assert.equal(normalized.soloist, true);
});

test('toPlaybackShape adapts alternative item structures', () => {
  const rawState = {
    playing: false,
    position: 0,
    repeat_track: true,
    current_track: {
      title: 'Alternative Track',
      artist: 'Single Artist',
      album_name: 'Flat Album',
      duration: 180000,
    },
  };

  const normalized = toPlaybackShape(rawState);
  assert.equal(normalized.is_playing, false);
  assert.equal(normalized.repeat_state, 'track');
  assert.equal(normalized.item.name, 'Alternative Track');
  assert.equal(normalized.item.artists[0].name, 'Single Artist');
  assert.equal(normalized.item.album.name, 'Flat Album');
});

test('SoloistClient encodes commands and parses events', () => {
  const sent = [];
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
    }
    send(data) {
      sent.push(JSON.parse(data));
    }
    close() {
      if (this.onclose) this.onclose();
    }
  }

  const client = new SoloistClient({
    port: 9090,
    autoReconnect: false,
    WebSocketImpl: MockWebSocket,
  });

  let connected = false;
  let receivedPlayback = null;
  let receivedQueue = null;

  client.on('connect', () => { connected = true; });
  client.on('playback', p => { receivedPlayback = p; });
  client.on('queue', q => { receivedQueue = q; });

  client.connect();
  assert.ok(client.ws);
  client.ws.onopen();

  assert.equal(connected, true);
  assert.equal(sent[0].command, 'get_auth_state');
  assert.equal(sent[1].command, 'get_state');
  assert.equal(sent[2].command, 'get_queue');

  // Commands
  client.play('spotify:track:123');
  assert.deepEqual(sent[3], { type: 'command', command: 'play', uri: 'spotify:track:123' });

  client.pause();
  assert.deepEqual(sent[4], { type: 'command', command: 'pause' });

  client.next();
  assert.deepEqual(sent[5], { type: 'command', command: 'skip_next' });

  client.previous();
  assert.deepEqual(sent[6], { type: 'command', command: 'skip_prev' });

  client.seek(45000);
  assert.deepEqual(sent[7], { type: 'command', command: 'seek', position_ms: 45000 });

  client.volume(65);
  assert.deepEqual(sent[8], { type: 'command', command: 'set_volume', volume: 65 });

  client.shuffle(true);
  assert.deepEqual(sent[9], { type: 'command', command: 'set_shuffle', enabled: true });

  client.repeat('track');
  assert.deepEqual(sent[10], { type: 'command', command: 'set_repeat_context', enabled: false });
  assert.deepEqual(sent[11], { type: 'command', command: 'set_repeat_track', enabled: true });

  client.enqueue('spotify:track:456');
  assert.deepEqual(sent[12], { type: 'command', command: 'add_to_queue', uri: 'spotify:track:456' });

  // Simulate server events
  client.ws.onmessage({
    data: JSON.stringify({
      type: 'playback_state',
      is_playing: true,
      position_ms: 5000,
      item: { name: 'Live Event Track' },
    }),
  });

  assert.ok(receivedPlayback);
  assert.equal(receivedPlayback.item.name, 'Live Event Track');
  assert.equal(receivedPlayback.is_playing, true);

  client.ws.onmessage({
    data: JSON.stringify({
      type: 'queue_changed',
      queue: [{ name: 'Upcoming 1' }],
    }),
  });

  assert.ok(receivedQueue);
  assert.equal(receivedQueue[0].name, 'Upcoming 1');

  client.destroy();
  assert.equal(client.connected, false);
});
