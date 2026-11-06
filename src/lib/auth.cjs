const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');

const REDIRECT_URI = 'http://127.0.0.1:43827/callback';
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state',
  'user-library-read', 'user-library-modify',
  'playlist-read-private', 'playlist-read-collaborative',
  'user-read-recently-played', 'user-top-read',
  'user-follow-read', 'user-read-private',
];

function createPKCE() {
  const verifier = randomBytes(64).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function sameState(expected, actual) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateCallback(url, state) {
  if (url.pathname !== '/callback') return { status: 404, message: 'Not found.' };
  if (!sameState(state, url.searchParams.get('state'))) {
    return { status: 400, message: 'Invalid sign-in state. Return to the original sign-in tab.' };
  }
  if (url.searchParams.has('error')) {
    return { status: 200, error: 'Spotify sign-in was declined. You can try again in Pocket.' };
  }
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) return { status: 400, message: 'Missing authorization code.' };
  return { status: 200, code };
}

// The listener exists only during sign-in, accepts only loopback traffic, and
// never puts a client secret in a distributed desktop application.
class OAuthLogin {
  constructor({ openExternal, port = 43827, timeout = 180_000 }) {
    this.openExternal = openExternal;
    this.port = port;
    this.timeout = timeout;
    this.cancelPending = null;
  }

  cancel() { this.cancelPending?.(); }

  authorize(clientId) {
    if (!/^[a-f0-9]{32}$/i.test(clientId)) throw new Error('Enter the 32-character Spotify Client ID.');
    if (this.cancelPending) throw new Error('Sign-in is already open in your browser.');
    const { verifier, challenge } = createPKCE();
    const state = randomBytes(32).toString('base64url');
    const redirectUri = `http://127.0.0.1:${this.port}/callback`;
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
      code_challenge_method: 'S256', code_challenge: challenge,
      state, scope: SCOPES.join(' '),
    }).toString();

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error, code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelPending = null;
        server.close();
        server.closeAllConnections();
        if (error) reject(error);
        else resolve({ code, verifier, redirectUri });
      };
      const server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${this.port}`) {
          res.writeHead(400).end('Invalid request.');
          return;
        }
        let result;
        try { result = validateCallback(new URL(req.url, redirectUri), state); }
        catch { res.writeHead(400).end('Invalid request.'); return; }
        if (result.code || result.error) {
          res.on('finish', () => finish(result.error ? new Error(result.error) : null, result.code));
        }
        res.writeHead(result.status);
        res.end(result.message || result.error || 'Spotify authorization received. You can close this tab and return to Pocket.');
      });
      server.on('error', error => finish(new Error(error.code === 'EADDRINUSE'
        ? `Sign-in port ${this.port} is in use. Close the other Pocket sign-in and try again.`
        : 'Could not start the local sign-in listener.')));
      timer = setTimeout(() => finish(new Error('Sign-in timed out. Please try again.')), this.timeout);
      this.cancelPending = () => finish(new Error('Sign-in canceled.'));
      server.listen(this.port, '127.0.0.1', () => {
        Promise.resolve().then(() => this.openExternal(url.href)).catch(() => finish(new Error('Could not open your browser.')));
      });
    });
  }
}

module.exports = { OAuthLogin, REDIRECT_URI, SCOPES, createPKCE, validateCallback };
