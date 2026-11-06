/**
 * Helper script to launch Spotify Soloist with credentials from .env
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function getApiKey() {
  if (process.env.SOLOIST_API_KEY) return process.env.SOLOIST_API_KEY.trim();
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
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
  }
  return null;
}

const apiKey = getApiKey();
if (!apiKey) {
  console.error('Error: SOLOIST_API_KEY not found in environment or .env file.');
  process.exit(1);
}

const port = process.env.SOLOIST_PORT || '9876';
const args = ['--device-name', 'Pocket', '--api-key', apiKey, '--ws', `127.0.0.1:${port}`];
const child = spawn('soloist', args, { stdio: 'inherit' });

child.on('error', error => {
  console.error('Failed to start soloist:', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code || 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
