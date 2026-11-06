/**
 * High-signal, formatted logger for Pocket.
 * Sanitizes sensitive credentials and prints color-coded terminal messages.
 */

const isDebug = process.argv.includes('--pocket-debug')
  || process.argv.includes('--verbose')
  || process.argv.includes('--debug')
  || Boolean(process.env.DEBUG || process.env.POCKET_DEBUG);

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

function colorForTag(tag, level) {
  if (level === 'error') return colors.red;
  if (level === 'warn') return colors.yellow;
  if (/Spotify/i.test(tag)) return colors.cyan;
  if (/Player|Playback/i.test(tag)) return colors.green;
  if (/MusicInfo/i.test(tag)) return colors.magenta;
  if (/Soloist/i.test(tag)) return colors.blue;
  if (/Librespot/i.test(tag)) return colors.yellow;
  return colors.dim;
}

function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (typeof value === 'object') {
    const copy = {};
    for (const [key, val] of Object.entries(value)) {
      if (/token|secret|authorization|verifier|challenge|cookie/i.test(key)) {
        copy[key] = '[REDACTED]';
      } else {
        copy[key] = sanitize(val);
      }
    }
    return copy;
  }
  return value;
}

class Logger {
  constructor({ enabled = isDebug, output = console } = {}) {
    this.enabled = enabled;
    this.output = output;
    this.history = [];
    this.maxHistory = 100;
  }

  logEntry(level, tag, ...args) {
    const timestamp = new Date().toISOString().slice(11, 19);
    const sanitizedArgs = args.map(sanitize);
    const entry = { timestamp, level, tag, args: sanitizedArgs };
    
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history.shift();

    if (this.enabled || level === 'error') {
      const tagColor = colorForTag(tag, level);
      const prefix = `${colors.dim}${timestamp}${colors.reset} ${tagColor}[${tag}]${colors.reset}`;
      const fn = this.output[level] || this.output.log;
      fn.call(this.output, prefix, ...sanitizedArgs);
    }
  }

  info(tag, ...args) { this.logEntry('info', tag, ...args); }
  debug(tag, ...args) { this.logEntry('debug', tag, ...args); }
  warn(tag, ...args) { this.logEntry('warn', tag, ...args); }
  error(tag, ...args) { this.logEntry('error', tag, ...args); }

  getHistory() {
    return [...this.history];
  }
}

const defaultLogger = new Logger();

module.exports = {
  Logger,
  logger: defaultLogger,
  sanitize,
  isDebug,
};
