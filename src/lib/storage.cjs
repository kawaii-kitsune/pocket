const fs = require('node:fs/promises');
const path = require('node:path');

class Storage {
  constructor(directory, safeStorage, platform = process.platform) {
    this.directory = directory;
    this.crypto = safeStorage;
    this.platform = platform;
    this.persistent = false;
    this.pending = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.persistent = await this.crypto.isAsyncEncryptionAvailable();
      if (this.platform === 'linux' && ['basic_text', 'unknown'].includes(this.crypto.getSelectedStorageBackend())) {
        this.persistent = false;
      }
    } catch { this.persistent = false; }
  }

  async readSettings() {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8')); }
    catch { return {}; }
  }

  async readSession() {
    if (!this.persistent) return null;
    try {
      const encrypted = await fs.readFile(path.join(this.directory, 'session.enc'));
      const { result, shouldReEncrypt } = await this.crypto.decryptStringAsync(encrypted);
      const session = JSON.parse(result);
      if (shouldReEncrypt) await this.saveSession(session);
      return session;
    } catch { return null; }
  }

  serialize(operation) {
    this.pending = this.pending.catch(() => {}).then(operation);
    return this.pending;
  }

  saveSettings(settings) {
    const text = JSON.stringify(settings);
    return this.serialize(() => this.atomicWrite('settings.json', text));
  }

  saveSession(session) {
    const text = session ? JSON.stringify(session) : null;
    return this.serialize(async () => {
      const file = path.join(this.directory, 'session.enc');
      if (!text || !this.persistent) {
        await fs.rm(file, { force: true });
        return;
      }
      try {
        await this.atomicWrite('session.enc', await this.crypto.encryptStringAsync(text));
      } catch {
        // Keep the current session in memory; never fall back to plaintext.
        this.persistent = false;
        await fs.rm(file, { force: true });
      }
    });
  }

  async atomicWrite(name, data) {
    const file = path.join(this.directory, name);
    await fs.writeFile(`${file}.tmp`, data, { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }
}
module.exports = { Storage };
