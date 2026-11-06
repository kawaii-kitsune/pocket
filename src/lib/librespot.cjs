/**
 * Bundled open-source audio engine manager (go-librespot / librespot).
 * Provides an embedded, zero-config Spotify Connect receiver that streams
 * directly through local speakers without requiring external official Spotify clients.
 */

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger.cjs');

function resolveBinaryPath() {
  const binaryName = process.platform === 'win32' ? 'go-librespot.exe' : 'go-librespot';
  
  // 1. Packaged Electron app extraResources path
  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, 'bin', binaryName);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  // 2. Local workspace bin/ path
  const localPath = path.join(__dirname, '..', '..', 'bin', binaryName);
  if (fs.existsSync(localPath)) return localPath;

  return null;
}

class LibrespotEngine extends EventEmitter {
  constructor({
    port = 3678,
    deviceName = 'Pocket Player',
    WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
  } = {}) {
    super();
    this.port = port;
    this.deviceName = deviceName;
    this.WebSocketImpl = WebSocketImpl;
    this.process = null;
    this.ws = null;
    this.running = false;
    this.connected = false;
    this.deviceId = null;
    this.active = false;
  }

  isAvailable() {
    return Boolean(resolveBinaryPath());
  }

  start() {
    if (this.process) return;
    const binPath = resolveBinaryPath();
    if (!binPath) {
      logger.debug('Librespot', 'Bundled audio engine not found; local engine skipped.');
      return;
    }

    const args = [
      '-c', `device_name=${this.deviceName}`,
      '-c', 'server.enabled=true',
      '-c', `server.port=${this.port}`,
      '-c', 'zeroconf_enabled=true',
      '-c', 'bitrate=320',
    ];

    try {
      this.process = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.running = true;
      logger.info('Librespot', `Started bundled audio engine: ${this.deviceName} on port ${this.port}`);

      this.process.stdout.on('data', data => {
        const text = data.toString();
        const idMatch = text.match(/device id:\s*([a-zA-Z0-9]+)/i);
        if (idMatch) {
          this.deviceId = idMatch[1];
          logger.info('Librespot', `Local Spotify Connect Device ID: ${this.deviceId}`);
          this.emit('device', { id: this.deviceId, name: this.deviceName });
        }
      });

      this.process.stderr.on('data', data => {
        logger.debug('Librespot:stderr', data.toString().trim());
      });

      this.process.on('error', err => {
        logger.warn('Librespot', 'Engine process error:', err.message);
        this.process = null;
        this.running = false;
      });

      this.process.on('exit', code => {
        logger.info('Librespot', `Engine process exited (code ${code})`);
        this.process = null;
        this.running = false;
        this.cleanupWs();
        this.emit('exit', code);
      });

      // Connect to event stream
      setTimeout(() => this.connectWs(), 1000);
    } catch (err) {
      logger.warn('Librespot', 'Could not spawn audio engine:', err.message);
    }
  }

  connectWs() {
    if (this.ws || !this.WebSocketImpl || !this.running) return;
    const url = `ws://127.0.0.1:${this.port}/events`;

    try {
      this.ws = new this.WebSocketImpl(url);
    } catch {
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      logger.info('Librespot', `Connected to local engine event stream on ${url}`);
      this.emit('ready', { deviceId: this.deviceId, port: this.port });
    };

    this.ws.onmessage = event => {
      try {
        const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        this.handleEvent(data);
      } catch {}
    };

    this.ws.onclose = () => {
      this.cleanupWs();
      if (this.running) {
        setTimeout(() => this.connectWs(), 3000);
      }
    };

    this.ws.onerror = () => {};
  }

  handleEvent(data) {
    if (!data) return;
    const type = data.event || data.type;

    if (type === 'active') {
      this.active = true;
      this.emit('active', true);
    } else if (type === 'inactive') {
      this.active = false;
      this.emit('active', false);
    } else if (['playing', 'paused', 'metadata', 'not_playing'].includes(type)) {
      this.emit('playback', {
        event: type,
        uri: data.uri,
        name: data.name,
        artists: data.artist_names?.map(name => ({ name })),
        album: { name: data.album_name, images: data.album_cover_url ? [{ url: data.album_cover_url }] : [] },
        duration_ms: data.duration,
        position_ms: data.position,
        is_playing: type === 'playing',
      });
    }
  }

  cleanupWs() {
    this.connected = false;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  stop() {
    this.cleanupWs();
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch {}
      this.process = null;
    }
    this.running = false;
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}

module.exports = {
  LibrespotEngine,
  resolveBinaryPath,
};
