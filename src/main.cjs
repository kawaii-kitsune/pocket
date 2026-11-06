const { app, BrowserWindow, ipcMain, shell, screen, safeStorage, protocol, net, Menu, Tray, nativeImage, globalShortcut } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Sentry = require('@sentry/electron/main');
const { autoUpdater } = require('electron-updater');
const { OAuthLogin, REDIRECT_URI } = require('./lib/auth.cjs');
const { SpotifyClient } = require('./lib/spotify.cjs');
const { Storage } = require('./lib/storage.cjs');
const { restoreBounds, snapToBounds } = require('./lib/window-state.cjs');
const { TaskbarController } = require('./lib/taskbar.cjs');
const { SoloistClient, isSoloistDisabled } = require('./lib/soloist.cjs');
const { LibrespotEngine } = require('./lib/librespot.cjs');
const { fetchLyrics } = require('./lib/lyrics.cjs');
const { logger, isDebug } = require('./lib/logger.cjs');
const APP_ID = 'app.pocket.spotifycompanion';

const SENTRY_DSN = process.env.SENTRY_DSN || '';
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: `pocket-spotify-companion@${app.getVersion()}`,
    environment: isDebug ? 'development' : 'production',
  });
}

// Match installed shortcuts and desktop entries so the window has its own
// taskbar/Dock identity, including while minimized.
if (process.platform === 'linux') {
  app.setDesktopName(`${APP_ID}.desktop`);
  app.commandLine.appendSwitch('disable-features', 'Vulkan');
  if (process.env.WAYLAND_DISPLAY) {
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  }
}
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

protocol.registerSchemesAsPrivileged([{ scheme: 'pocket', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win;
let storage;
let spotify;
let login;
let taskbar;
let soloist;
let librespot;
let settings = {};
let compact = false;
let expandedBounds;
let saveTimer;
let quitting = false;
const demo = process.argv.includes('--demo');
const rendererRoot = path.join(__dirname, 'renderer');
const appIcon = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const assets = new Set(['index.html', 'app.js', 'demo.js', 'icons.js', 'style.css', 'cover.svg']);

function loadIcons() {
  const assetsDir = path.join(__dirname, 'assets');
  const trayPath = path.join(assetsDir, 'tray.png');
  const trayImage = nativeImage.createFromPath(trayPath);
  const icons = {
    tray: trayImage.isEmpty() ? nativeImage.createFromPath(appIcon).resize({ width: 24, height: 24 }) : trayImage,
  };
  if (process.platform === 'win32') {
    const thumbarDir = path.join(assetsDir, 'thumbar');
    icons.play = nativeImage.createFromPath(path.join(thumbarDir, 'play.png'));
    icons.pause = nativeImage.createFromPath(path.join(thumbarDir, 'pause.png'));
    icons.prev = nativeImage.createFromPath(path.join(thumbarDir, 'prev.png'));
    icons.next = nativeImage.createFromPath(path.join(thumbarDir, 'next.png'));
  }
  return icons;
}

function restoreWindow() {
  if (!win || win.isDestroyed() || quitting) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function persistSettings() {
  if (!win || win.isDestroyed()) return Promise.resolve();
  const bounds = win.getBounds();
  settings.bounds = compact ? { ...bounds, height: expandedBounds?.height || 540 } : bounds;
  settings.pinned = win.isAlwaysOnTop();
  return storage.saveSettings(settings).catch(error => console.error('Could not save window preferences:', error.code));
}

function windowState() { return { compact, pinned: win.isAlwaysOnTop() }; }

const DEFAULT_CLIENT_ID = 'c16e5f34bc8a4f1bada5a3b539731ea2';

function getEnvClientId() {
  if (process.env.SPOTIFY_CLIENT_ID) return process.env.SPOTIFY_CLIENT_ID.trim();
  if (process.env.CLIENT_ID) return process.env.CLIENT_ID.trim();
  const envPath = path.join(__dirname, '..', '.env');
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
          if (key === 'SPOTIFY_CLIENT_ID' || key === 'CLIENT_ID') return val;
        }
      }
    } catch {}
  }
  return DEFAULT_CLIENT_ID;
}

function status() {
  const clientId = settings.clientId || getEnvClientId() || '';
  return { connected: spotify.connected, soloist: Boolean(soloist?.connected), librespot: Boolean(librespot?.running), enableReceiver: Boolean(settings.enableReceiver), clientId, persistent: storage.persistent, redirectUri: REDIRECT_URI, demo, debug: isDebug, ...windowState() };
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame
        || event.senderFrame.url !== 'pocket://app/index.html') throw new Error('Untrusted request.');
    logger.debug('Main:IPC', channel, ...args);
    try { return { ok: true, data: await callback(...args) }; }
    catch (error) {
      if (channel !== 'pocket:action' || (error.status !== 403 && error.status !== 404)) {
        logger.error('Main:IPC', `${channel} error:`, error.message);
      }
      return { ok: false, error: error.message, status: error.status || 0, retryAfter: error.retryAfter || 0 };
    }
  });
}

async function createWindow() {
  const bounds = restoreBounds(settings.bounds, screen.getAllDisplays().map(d => d.workArea));
  win = new BrowserWindow({
    ...bounds, minWidth: 360, minHeight: 460, maxWidth: 640, maxHeight: 900,
    title: 'Pocket · Spotify companion', frame: false, show: false, icon: appIcon,
    skipTaskbar: false, minimizable: true, focusable: true,
    ...(process.platform === 'linux' ? { type: 'normal' } : {}),
    alwaysOnTop: settings.pinned !== false, backgroundColor: '#131615',
    fullscreenable: false, maximizable: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  for (const event of ['move', 'resize']) {
    win.on(event, () => { clearTimeout(saveTimer); saveTimer = setTimeout(persistSettings, 250); });
  }
  win.on('moved', () => {
    try {
      const currentBounds = win.getBounds();
      const display = screen.getDisplayMatching(currentBounds);
      const snapped = snapToBounds(currentBounds, display.workArea, 20);
      if (snapped.x !== currentBounds.x || snapped.y !== currentBounds.y) {
        win.setBounds(snapped);
      }
    } catch {}
  });
  for (const event of ['minimize', 'restore']) {
    win.on(event, () => taskbar?.updateTray());
  }
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    clearTimeout(saveTimer);
    login.cancel();
    persistSettings().finally(() => app.quit());
  });
  win.once('ready-to-show', () => {
    win.show();
    if (isDebug) {
      win.webContents.openDevTools({ mode: 'detach' });
      logger.info('Main', 'Debug mode active. DevTools opened.');
    }
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        logger.debug('AutoUpdater', 'Check for updates failed:', err.message);
      });
    }
  });
  await win.loadURL('pocket://app/index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', restoreWindow);
  app.on('activate', restoreWindow);
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      app.setActivationPolicy('regular');
      app.dock.setIcon(appIcon);
      await app.dock.show();
    }
    storage = new Storage(app.getPath('userData'), safeStorage);
    await storage.initialize();
    settings = await storage.readSettings();
    if (!settings || typeof settings !== 'object') settings = {};
    spotify = new SpotifyClient({ saveSession: session => storage.saveSession(session) });
    if (!demo) spotify.restore(await storage.readSession());
    login = new OAuthLogin({ openExternal: url => shell.openExternal(url) });

    protocol.handle('pocket', request => {
      const url = new URL(request.url);
      const file = url.pathname.slice(1);
      if (url.host !== 'app' || !assets.has(file)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(rendererRoot, file)).href);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Pocket', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    ]));

    handle('pocket:status', status);
    handle('pocket:connect', async clientId => {
      if (spotify.connected) throw new Error('Disconnect your current account first.');
      if (typeof clientId !== 'string' || !/^[a-f0-9]{32}$/i.test(clientId.trim())) throw new Error('Enter the 32-character Spotify Client ID.');
      clientId = clientId.trim();
      const authorization = await login.authorize(clientId);
      await spotify.connect(clientId, authorization);
      settings.clientId = clientId;
      await persistSettings();
      restoreWindow();
      return status();
    });
    handle('pocket:cancel-login', () => login.cancel());
    handle('pocket:disconnect', async () => { login.cancel(); await spotify.disconnect(); return status(); });
    handle('pocket:action', async (name, args) => {
      if (soloist?.connected) {
        switch (name) {
          case 'play': soloist.play(args?.uri); return null;
          case 'pause': soloist.pause(); return null;
          case 'next': soloist.next(); return null;
          case 'previous': soloist.previous(); return null;
          case 'seek': soloist.seek(args?.position); return null;
          case 'volume': soloist.volume(args?.volume); return null;
          case 'shuffle': soloist.shuffle(args?.enabled); return null;
          case 'repeat': soloist.repeat(args?.mode); return null;
          case 'enqueue': soloist.enqueue(args?.uri); return null;
          case 'activate': soloist.activate(); return null;
          default: break;
        }
      }
      return spotify.action(name, args);
    });
    handle('pocket:window', async action => {
      if (action === 'pin') win.setAlwaysOnTop(!win.isAlwaysOnTop());
      else if (action === 'compact') {
        if (!compact) {
          expandedBounds = win.getBounds();
          compact = true;
          win.setMinimumSize(360, 200);
          win.setMaximumSize(640, 200);
          win.setSize(expandedBounds.width, 200);
        } else {
          compact = false;
          win.setMaximumSize(640, 900);
          win.setMinimumSize(360, 460);
          const bounds = restoreBounds({ ...win.getBounds(), height: expandedBounds?.height || 540 }, screen.getAllDisplays().map(d => d.workArea));
          win.setBounds(bounds);
        }
      } else if (action === 'minimize') win.minimize();
      else if (action === 'close') win.close();
      else throw new Error('Unknown window action.');
      await persistSettings();
      return windowState();
    });
    handle('pocket:open', value => {
      const links = {
        dashboard: 'https://developer.spotify.com/dashboard',
        spotify: 'https://open.spotify.com',
        access: 'https://developer.spotify.com/documentation/web-api/concepts/quota-modes',
      };
      if (links[value]) return shell.openExternal(links[value]);
      if (typeof value === 'string' && /^spotify:(track|episode|album|artist|playlist):[a-zA-Z0-9]{22}$/.test(value)) {
        const [, type, id] = value.split(':');
        return shell.openExternal(`https://open.spotify.com/${type}/${id}`);
      }
      throw new Error('Unsupported link.');
    });
    handle('pocket:playback-state', async playbackState => {
      taskbar?.update(playbackState);
      return { ok: true };
    });
    handle('pocket:log', async (level, tag, ...args) => {
      if (typeof logger[level] === 'function') logger[level](tag, ...args);
      return { ok: true };
    });
    handle('pocket:lyrics', args => fetchLyrics(args));
    handle('pocket:toggle-receiver', async enabled => {
      settings.enableReceiver = Boolean(enabled);
      if (settings.enableReceiver) {
        if (!librespot?.running && librespot?.isAvailable() && !demo) {
          librespot.start();
          librespot.on('device', dev => {
            logger.info('Main', `Bundled audio engine ready: ${dev.name} (${dev.id})`);
          });
        }
      } else if (librespot?.running) {
        librespot.stop();
        logger.info('Main', 'Bundled audio engine stopped.');
      }
      await persistSettings();
      return status();
    });
    handle('pocket:check-for-updates', async () => {
      if (app.isPackaged) return autoUpdater.checkForUpdates();
      return null;
    });
    handle('pocket:install-update', () => {
      autoUpdater.quitAndInstall();
    });
    await createWindow();
    taskbar = new TaskbarController({
      platform: process.platform,
      win,
      app,
      Tray,
      Menu,
      icons: loadIcons(),
      onAction: (name, args) => {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('pocket:remote-action', name, args);
        } else if (soloist?.connected) {
          switch (name) {
            case 'play': soloist.play(args?.uri); break;
            case 'pause': soloist.pause(); break;
            case 'next': soloist.next(); break;
            case 'previous': soloist.previous(); break;
            case 'volume': soloist.volume(args?.volume); break;
            case 'shuffle': soloist.shuffle(args?.enabled); break;
            case 'repeat': soloist.repeat(args?.mode); break;
            default: break;
          }
        } else if (spotify?.connected) {
          spotify.action(name, args).catch(error => console.error('Spotify action failed:', error.message));
        }
      },
      onWindowAction: action => {
        if (win && !win.isDestroyed()) {
          if (action === 'pin') {
            win.setAlwaysOnTop(!win.isAlwaysOnTop());
            taskbar?.update({ pinned: win.isAlwaysOnTop() });
            persistSettings();
          } else if (action === 'compact') {
            if (!compact) {
              expandedBounds = win.getBounds();
              compact = true;
              win.setMinimumSize(360, 200);
              win.setMaximumSize(640, 200);
              win.setSize(expandedBounds.width, 200);
            } else {
              compact = false;
              win.setMaximumSize(640, 900);
              win.setMinimumSize(360, 460);
              const bounds = restoreBounds({ ...win.getBounds(), height: expandedBounds?.height || 540 }, screen.getAllDisplays().map(d => d.workArea));
              win.setBounds(bounds);
            }
            taskbar?.update({ compact });
            if (win.webContents) win.webContents.send('pocket:window-state', windowState());
            persistSettings();
          }
        }
      },
      onRestore: restoreWindow,
      onQuit: () => {
        quitting = true;
        clearTimeout(saveTimer);
        login?.cancel();
        persistSettings().finally(() => app.quit());
      },
    });
    taskbar.init();
    if (!isSoloistDisabled()) {
      soloist = new SoloistClient();
      soloist.on('connect', () => {
        logger.info('Main', 'Connected to local Spotify Soloist.');
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('pocket:soloist-status', true);
        }
        if (spotify?.connected) soloist.activate();
      });
      soloist.on('disconnect', () => {
        logger.info('Main', 'Disconnected from local Spotify Soloist.');
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('pocket:soloist-status', false);
        }
      });
      soloist.on('playback', p => {
        taskbar?.update(p);
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('pocket:remote-playback', p);
        }
      });
      soloist.on('queue', q => {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('pocket:remote-queue', q);
        }
      });
      soloist.connect();
    } else {
      logger.info('Main', 'Spotify Soloist is turned off; running in standalone mode.');
    }
    librespot = new LibrespotEngine({ deviceName: 'Pocket' });
    if (librespot.isAvailable() && !demo && settings.enableReceiver) {
      librespot.start();
      librespot.on('device', dev => {
        logger.info('Main', `Bundled audio engine ready: ${dev.name} (${dev.id})`);
      });
    }

    autoUpdater.on('update-available', info => {
      logger.info('AutoUpdater', `Update available: ${info.version}`);
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send('pocket:update-available', info);
      }
    });
    autoUpdater.on('update-downloaded', info => {
      logger.info('AutoUpdater', `Update downloaded: ${info.version}`);
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send('pocket:update-downloaded', info);
      }
    });

    registerMediaShortcuts();
  }).catch(error => { console.error('Pocket could not start:', error); app.quit(); });
}

function registerMediaShortcuts() {
  const map = [
    ['MediaPlayPause', 'playpause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous'],
  ];
  for (const [key, action] of map) {
    try {
      globalShortcut.register(key, () => {
        logger.info('Main', `Global media key triggered: ${key}`);
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('pocket:remote-action', action);
        } else if (soloist?.connected) {
          if (action === 'playpause') {
            if (soloist.lastState?.is_playing) soloist.pause();
            else soloist.play();
          } else if (action === 'next') soloist.next();
          else if (action === 'previous') soloist.previous();
        }
      });
    } catch (err) {
      logger.debug('Main', `Could not register media key ${key}:`, err.message);
    }
  }
}

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  login?.cancel();
  taskbar?.destroy();
  soloist?.destroy();
  librespot?.destroy();
});
app.on('window-all-closed', () => app.quit());
