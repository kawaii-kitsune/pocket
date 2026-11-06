const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Logger, sanitize } = require('../src/lib/logger.cjs');

test('sanitize scrubs auth tokens and sensitive credential keys', () => {
  assert.equal(sanitize('Bearer secret12345'), 'Bearer [REDACTED]');
  assert.equal(sanitize('Bearer abc-123_xyz.789'), 'Bearer [REDACTED]');

  const sensitive = {
    clientId: '12345678901234567890123456789012',
    accessToken: 'secret_token',
    refreshToken: 'refresh_secret',
    code_verifier: 'verifier_string',
    nested: {
      client_secret: 'nested_secret',
      normalField: 'safe_value',
    },
    authHeader: 'Bearer secret12345',
  };

  const cleaned = sanitize(sensitive);
  assert.equal(cleaned.clientId, '12345678901234567890123456789012');
  assert.equal(cleaned.accessToken, '[REDACTED]');
  assert.equal(cleaned.refreshToken, '[REDACTED]');
  assert.equal(cleaned.code_verifier, '[REDACTED]');
  assert.equal(cleaned.nested.client_secret, '[REDACTED]');
  assert.equal(cleaned.nested.normalField, 'safe_value');
  assert.equal(cleaned.authHeader, 'Bearer [REDACTED]');
});

test('Logger records history and routes to output correctly', () => {
  const logged = [];
  const mockOutput = {
    info: (...args) => logged.push({ level: 'info', args }),
    debug: (...args) => logged.push({ level: 'debug', args }),
    warn: (...args) => logged.push({ level: 'warn', args }),
    error: (...args) => logged.push({ level: 'error', args }),
  };

  const logger = new Logger({ enabled: true, output: mockOutput });
  logger.info('Test', 'Info message', { normal: 'data' });
  logger.debug('Spotify', 'GET /me/player');
  logger.error('Spotify', 'PUT /me/player/play failed', { token: 'secret' });

  assert.equal(logged.length, 3);
  assert.equal(logged[0].level, 'info');
  assert.match(logged[0].args[0], /\[Test\]/);
  assert.equal(logged[2].level, 'error');
  assert.deepEqual(logged[2].args[2], { token: '[REDACTED]' });

  const history = logger.getHistory();
  assert.equal(history.length, 3);
  assert.equal(history[1].tag, 'Spotify');
});
