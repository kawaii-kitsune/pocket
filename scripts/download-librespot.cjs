/**
 * Auto-downloader for bundled go-librespot audio engine.
 * Downloads the appropriate prebuilt binary for the current OS and architecture.
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'v0.10.5';
const BASE_URL = `https://github.com/devgianlu/go-librespot/releases/download/${VERSION}`;

function getBinaryTarget() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    if (arch === 'x64') return { archive: `go-librespot_linux_x86_64.tar.gz`, binaryName: 'go-librespot' };
    if (arch === 'arm64') return { archive: `go-librespot_linux_arm64.tar.gz`, binaryName: 'go-librespot' };
  } else if (platform === 'win32') {
    if (arch === 'x64') return { archive: `go-librespot_windows_amd64.tar.gz`, binaryName: 'go-librespot.exe' };
  }
  return null;
}

async function main() {
  const target = getBinaryTarget();
  if (!target) {
    console.log(`[librespot] Prebuilt binary not available for ${process.platform}-${process.arch}; skipping download.`);
    return;
  }

  const binDir = path.join(__dirname, '..', 'bin');
  const binaryPath = path.join(binDir, target.binaryName);

  if (fs.existsSync(binaryPath)) {
    console.log(`[librespot] Bundled audio engine already present at ${binaryPath}`);
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });
  const archiveUrl = `${BASE_URL}/${target.archive}`;
  const archivePath = path.join(binDir, target.archive);

  console.log(`[librespot] Downloading bundled audio engine from ${archiveUrl}...`);
  try {
    const res = await fetch(archiveUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Download failed with HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(archivePath, Buffer.from(buffer));

    console.log(`[librespot] Extracting ${target.archive}...`);
    execSync(`tar -xzf "${archivePath}" -C "${binDir}"`);
    fs.unlinkSync(archivePath);

    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }
    console.log(`[librespot] Successfully installed bundled audio engine to ${binaryPath}`);
  } catch (error) {
    console.warn(`[librespot] Could not download bundled binary: ${error.message}`);
    try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
  }
}

main().catch(err => {
  console.warn(`[librespot] Download script warning: ${err.message}`);
});
