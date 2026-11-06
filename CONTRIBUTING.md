# Contributing to Pocket

Thank you for your interest in contributing to Pocket! Pocket is an open-source Spotify companion desktop application designed to stay lightweight, fast, and secure.

## Development Setup

1. **Prerequisites:**
   - Node.js >= 22
   - npm >= 10

2. **Clone and Install:**
   ```bash
   git clone https://github.com/kawaii-kitsune/pocket.git
   cd pocket
   npm install
   cp .env.example .env
   ```

3. **Running the App:**
   - Standard run: `npm start`
   - Verbose debug mode (with DevTools): `npm run debug`
   - Offline demo mode (no Spotify account needed): `npm run demo`
   - Browser preview (standalone UI test): `npm run preview`

## Code Standards & Testing

Before submitting a Pull Request, make sure all automated checks and tests pass:

```bash
npm run check              # JavaScript syntax verification
npm test                   # Unit and integration tests (40 tests)
node scripts/ui-smoke.cjs  # UI interaction test suite
npm audit                  # Verify dependencies are vulnerability-free
```

## Pull Request Guidelines

- Keep changes focused on a single bug fix or feature.
- Follow existing patterns (Vanilla JS, strict CSP, isolated IPC bridge in `preload.cjs`).
- Add or update relevant tests in `test/` for any new logic or bug fixes.
- Do not commit secrets, tokens, or personal configuration files.
