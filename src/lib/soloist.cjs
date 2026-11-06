/**
 * Spotify Soloist WebSocket Client.
 * Connects to the local Spotify Soloist headless receiver via WebSocket
 * for zero-latency playback control, local PipeWire/PulseAudio playback, and real-time events.
 */

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { logger } = require('./logger.cjs');

function isSoloistDisabled() {
  if (process.argv.includes('--no-soloist')) return true;
  if (process.env.SOLOIST === 'false' || process.env.ENABLE_SOLOIST === '0' || process.env.DISABLE_SOLOIST === '1') return true;
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === 'SOLOIST=false' || trimmed === 'ENABLE_SOLOIST=false' || trimmed === 'ENABLE_SOLOIST=0') return true;
      }
    } catch {}
  }
  return false;
}

function readEnvKey() {
  if (isSoloistDisabled()) return null;
  if (process.env.SOLOIST_API_KEY) return process.env.SOLOIST_API_KEY.trim();
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index !== -1) {
          const key = trimmed.slice(0, index).trim();
          let val = trimmed.slice(index + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key === 'SOLOIST_API_KEY') return val;
        }
      }
    } catch {}
  }
  return null;
}

function toPlaybackShape(soloistState) {
  if (!soloistState) return null;
  const item = soloistState.item || soloistState.track || soloistState.current_track;
  const artists = Array.isArray(item?.artists)
    ? item.artists
    : (item?.artist ? [{ name: String(item.artist) }] : []);

  const album = item?.album && typeof item.album === 'object'
    ? item.album
    : { name: item?.album_name || '', images: item?.images || [] };

  return {
    item: item ? {
      id: item.id || (item.uri && /^spotify:track:([a-zA-Z0-9]{22})$/.test(item.uri) ? item.uri.split(':').pop() : null),
      uri: item.uri || (item.id ? `spotify:track:${item.id}` : null),
      name: item.name || item.title || 'Unknown Track',
      duration_ms: item.duration_ms || item.duration || 0,
      artists,
      album,
      type: item.type || 'track',
    } : null,
    is_playing: Boolean(soloistState.is_playing ?? soloistState.playing),
    progress_ms: soloistState.position_ms ?? soloistState.position ?? 0,
    shuffle_state: Boolean(soloistState.shuffle_state ?? soloistState.shuffle),
    repeat_state: soloistState.repeat_state || (soloistState.repeat_track ? 'track' : (soloistState.repeat_context ? 'context' : 'off')),
    device: {
      id: 'soloist-local',
      name: soloistState.device_name || 'Spotify Soloist (Local)',
      type: 'Computer',
      is_active: true,
      is_restricted: false,
      volume_percent: soloistState.volume ?? 100,
      supports_volume: true,
    },
    actions: { disallows: soloistState.actions?.disallows || {} },
    soloist: true,
  };
}

class SoloistClient extends EventEmitter {
  constructor({
    host = '127.0.0.1',
    port = Number(process.env.SOLOIST_PORT || 9876),
    autoReconnect = true,
    WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
  } = {}) {
    super();
    this.host = host;
    this.defaultPort = port;
    this.activePort = port;
    this.autoReconnect = autoReconnect;
    this.WebSocketImpl = WebSocketImpl;
    this.ws = null;
    this.childProcess = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.lastState = null;
    this.lastQueue = [];
    this.lastAuth = null;
  }

  discoverPort() {
    const candidatePaths = [
      path.join(os.homedir(), '.local', 'share', 'spotify-soloist', 'ws.port'),
      path.join(os.homedir(), '.config', 'spotify-soloist', 'ws.port'),
      path.join(os.tmpdir(), 'spotify-soloist', 'ws.port'),
    ];

    for (const file of candidatePaths) {
      try {
        if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, 'utf8').trim();
          const parsed = parseInt(content, 10);
          if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65535) {
            return parsed;
          }
        }
      } catch {}
    }
    return this.defaultPort;
  }

  startManagedProcess(apiKey = readEnvKey()) {
    if (this.childProcess || !apiKey) return;
    try {
      const args = ['--device-name', 'Pocket', '--api-key', apiKey, '--ws', `${this.host}:${this.activePort}`];
      this.childProcess = spawn('soloist', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.childProcess.on('error', err => {
        logger.debug('Soloist', 'Managed soloist process failed to start:', err.message);
        this.childProcess = null;
      });
      this.childProcess.on('exit', () => {
        this.childProcess = null;
      });
      logger.info('Soloist', `Started managed background Soloist on port ${this.activePort}`);
    } catch (err) {
      logger.debug('Soloist', 'Could not spawn managed Soloist:', err.message);
    }
  }

  connect() {
    if (this.ws || !this.WebSocketImpl) return;
    this.activePort = this.discoverPort();
    if (!this.childProcess && readEnvKey()) {
      this.startManagedProcess();
    }
    const url = `ws://${this.host}:${this.activePort}`;

    try {
      this.ws = new this.WebSocketImpl(url);
    } catch (error) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      logger.info('Soloist', `Connected to local Spotify Soloist on ${url}`);
      this.emit('connect', { host: this.host, port: this.activePort });
      this.sendCommand('get_auth_state');
      this.sendCommand('get_state');
      this.sendCommand('get_queue', { limit: 20 });
    };

    this.ws.onmessage = event => {
      try {
        const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        this.handleMessage(data);
      } catch (err) {
        logger.debug('Soloist', 'Malformed WebSocket frame:', err.message);
      }
    };

    this.ws.onclose = () => {
      const wasConnected = this.connected;
      this.cleanup();
      if (wasConnected) {
        logger.info('Soloist', 'Disconnected from local Spotify Soloist.');
        this.emit('disconnect');
      }
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // Handled cleanly by onclose
    };
  }

  scheduleReconnect() {
    if (!this.autoReconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 4000);
  }

  handleMessage(data) {
    if (!data || typeof data !== 'object') return;
    const type = data.type || data.event;

    switch (type) {
      case 'playback_state': {
        this.lastState = data;
        const normalized = toPlaybackShape(data);
        this.emit('playback', normalized);
        break;
      }
      case 'position_sync': {
        if (this.lastState && data.position_ms != null) {
          this.lastState.position_ms = data.position_ms;
          this.emit('position', data.position_ms);
        }
        break;
      }
      case 'queue_changed': {
        this.lastQueue = data.queue || data.items || [];
        this.emit('queue', this.lastQueue);
        break;
      }
      case 'auth_state': {
        this.lastAuth = data;
        this.emit('auth', data);
        break;
      }
      case 'command_result': {
        if (!data.success && data.error) {
          logger.warn('Soloist', 'Command rejected by Soloist:', data.error);
        }
        break;
      }
      default:
        break;
    }
  }

  sendCommand(command, payload = {}) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      return false;
    }
    const message = JSON.stringify({
      type: 'command',
      command,
      ...payload,
    });
    try {
      this.ws.send(message);
      logger.debug('Soloist:Send', command, payload);
      return true;
    } catch (error) {
      logger.warn('Soloist', `Failed to send command ${command}:`, error.message);
      return false;
    }
  }

  play(uri) {
    return this.sendCommand('play', uri ? { uri } : {});
  }

  pause() {
    return this.sendCommand('pause');
  }

  next() {
    return this.sendCommand('skip_next');
  }

  previous() {
    return this.sendCommand('skip_prev');
  }

  seek(positionMs) {
    return this.sendCommand('seek', { position_ms: Math.max(0, Math.round(positionMs)) });
  }

  volume(percent) {
    return this.sendCommand('set_volume', { volume: Math.max(0, Math.min(100, Math.round(percent))) });
  }

  shuffle(enabled) {
    return this.sendCommand('set_shuffle', { enabled: Boolean(enabled) });
  }

  repeat(mode) {
    if (mode === 'track') {
      this.sendCommand('set_repeat_context', { enabled: false });
      return this.sendCommand('set_repeat_track', { enabled: true });
    }
    if (mode === 'context') {
      this.sendCommand('set_repeat_track', { enabled: false });
      return this.sendCommand('set_repeat_context', { enabled: true });
    }
    this.sendCommand('set_repeat_track', { enabled: false });
    return this.sendCommand('set_repeat_context', { enabled: false });
  }

  enqueue(uri) {
    return this.sendCommand('add_to_queue', { uri });
  }

  activate() {
    return this.sendCommand('activate');
  }

  deactivate() {
    return this.sendCommand('deactivate');
  }

  cleanup() {
    this.connected = false;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  destroy() {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.childProcess) {
      try { this.childProcess.kill('SIGTERM'); } catch {}
      this.childProcess = null;
    }
    this.cleanup();
    this.removeAllListeners();
  }
}

module.exports = {
  SoloistClient,
  toPlaybackShape,
  isSoloistDisabled,
};
