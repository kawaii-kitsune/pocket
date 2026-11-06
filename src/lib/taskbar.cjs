/**
 * Native taskbar, dock, and system tray controls for Windows, macOS, and Linux.
 */

function formatTooltip(state = {}) {
  if (state.title) {
    const artist = state.artist ? ` · ${state.artist}` : '';
    const status = state.isPlaying ? 'Playing' : 'Paused';
    return `${state.title}${artist} (${status}) · Pocket`;
  }
  return 'Pocket · Spotify companion';
}

function buildTrayMenuTemplate({
  state = {},
  onAction = () => {},
  onWindowAction = () => {},
  onRestore = () => {},
  onQuit = () => {},
  isMinimized = false,
} = {}) {
  const hasTrack = Boolean(state.title);
  const titleLabel = hasTrack ? `${state.title}${state.artist ? ` · ${state.artist}` : ''}` : 'Pocket · No playback';
  const isPlaying = Boolean(state.isPlaying);
  const canPlayPause = state.canPlayPause ?? hasTrack;
  const canNext = state.canNext ?? hasTrack;
  const canPrevious = state.canPrevious ?? hasTrack;
  const canSave = Boolean(state.canSave ?? hasTrack);
  const isSaved = Boolean(state.isSaved);
  const volume = state.volume ?? 50;
  const isMuted = Boolean(state.muted || volume === 0);

  return [
    { label: titleLabel, enabled: false },
    { type: 'separator' },
    {
      label: isPlaying ? 'Pause' : 'Play',
      enabled: Boolean(canPlayPause),
      click: () => onAction(isPlaying ? 'pause' : 'play'),
    },
    {
      label: 'Next Track',
      enabled: Boolean(canNext),
      click: () => onAction('next'),
    },
    {
      label: 'Previous Track',
      enabled: Boolean(canPrevious),
      click: () => onAction('previous'),
    },
    {
      label: isSaved ? '♥ In Liked Songs' : '♡ Save to Liked Songs',
      enabled: Boolean(canSave && hasTrack),
      click: () => onAction(isSaved ? 'unsave' : 'save', { uri: state.uri }),
    },
    { type: 'separator' },
    {
      label: `Volume: ${isMuted ? 'Muted' : `${volume}%`}`,
      submenu: [
        {
          label: isMuted ? 'Unmute Audio' : 'Mute Audio',
          click: () => onAction('volume', { volume: isMuted ? (state.unmutedVolume || 50) : 0 }),
        },
        { type: 'separator' },
        { label: '100%', click: () => onAction('volume', { volume: 100 }) },
        { label: '75%', click: () => onAction('volume', { volume: 75 }) },
        { label: '50%', click: () => onAction('volume', { volume: 50 }) },
        { label: '25%', click: () => onAction('volume', { volume: 25 }) },
      ],
    },
    {
      label: 'Shuffle',
      type: 'checkbox',
      checked: Boolean(state.shuffle),
      click: () => onAction('shuffle', { enabled: !state.shuffle }),
    },
    {
      label: `Repeat (${state.repeat || 'off'})`,
      submenu: [
        {
          label: 'Off',
          type: 'radio',
          checked: !state.repeat || state.repeat === 'off',
          click: () => onAction('repeat', { mode: 'off' }),
        },
        {
          label: 'Repeat Context',
          type: 'radio',
          checked: state.repeat === 'context',
          click: () => onAction('repeat', { mode: 'context' }),
        },
        {
          label: 'Repeat Track',
          type: 'radio',
          checked: state.repeat === 'track',
          click: () => onAction('repeat', { mode: 'track' }),
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: Boolean(state.pinned),
      click: () => onWindowAction('pin'),
    },
    {
      label: 'Compact Player',
      type: 'checkbox',
      checked: Boolean(state.compact),
      click: () => onWindowAction('compact'),
    },
    {
      label: isMinimized ? 'Restore Pocket' : 'Minimize Pocket',
      click: () => onRestore(),
    },
    { type: 'separator' },
    {
      label: 'Quit Pocket',
      click: () => onQuit(),
    },
  ];
}

function buildDockMenuTemplate({
  state = {},
  onAction = () => {},
  onWindowAction = () => {},
  onRestore = () => {},
} = {}) {
  const hasTrack = Boolean(state.title);
  const titleLabel = hasTrack ? `${state.title}${state.artist ? ` · ${state.artist}` : ''}` : 'Pocket · No playback';
  const isPlaying = Boolean(state.isPlaying);
  const canPlayPause = state.canPlayPause ?? hasTrack;
  const canNext = state.canNext ?? hasTrack;
  const canPrevious = state.canPrevious ?? hasTrack;
  const canSave = Boolean(state.canSave ?? hasTrack);
  const isSaved = Boolean(state.isSaved);

  return [
    { label: titleLabel, enabled: false },
    { type: 'separator' },
    {
      label: isPlaying ? 'Pause' : 'Play',
      enabled: Boolean(canPlayPause),
      click: () => onAction(isPlaying ? 'pause' : 'play'),
    },
    {
      label: 'Next Track',
      enabled: Boolean(canNext),
      click: () => onAction('next'),
    },
    {
      label: 'Previous Track',
      enabled: Boolean(canPrevious),
      click: () => onAction('previous'),
    },
    {
      label: isSaved ? '♥ In Liked Songs' : '♡ Save to Liked Songs',
      enabled: Boolean(canSave && hasTrack),
      click: () => onAction(isSaved ? 'unsave' : 'save', { uri: state.uri }),
    },
    { type: 'separator' },
    {
      label: 'Shuffle',
      type: 'checkbox',
      checked: Boolean(state.shuffle),
      click: () => onAction('shuffle', { enabled: !state.shuffle }),
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: Boolean(state.pinned),
      click: () => onWindowAction('pin'),
    },
    {
      label: 'Compact Player',
      type: 'checkbox',
      checked: Boolean(state.compact),
      click: () => onWindowAction('compact'),
    },
    { type: 'separator' },
    {
      label: 'Restore Pocket',
      click: () => onRestore(),
    },
  ];
}

function buildThumbarButtons({ state = {}, icons = {}, onAction = () => {} } = {}) {
  const hasTrack = Boolean(state.title);
  const isPlaying = Boolean(state.isPlaying);
  const canPlayPause = state.canPlayPause ?? hasTrack;
  const canNext = state.canNext ?? hasTrack;
  const canPrevious = state.canPrevious ?? hasTrack;

  return [
    {
      tooltip: 'Previous Track',
      icon: icons.prev,
      flags: canPrevious ? [] : ['disabled'],
      click: () => onAction('previous'),
    },
    {
      tooltip: isPlaying ? 'Pause' : 'Play',
      icon: isPlaying ? icons.pause : icons.play,
      flags: canPlayPause ? [] : ['disabled'],
      click: () => onAction(isPlaying ? 'pause' : 'play'),
    },
    {
      tooltip: 'Next Track',
      icon: icons.next,
      flags: canNext ? [] : ['disabled'],
      click: () => onAction('next'),
    },
  ];
}

class TaskbarController {
  constructor({
    platform = process.platform,
    win = null,
    app = null,
    Tray = null,
    Menu = null,
    icons = {},
    onAction = () => {},
    onWindowAction = () => {},
    onRestore = () => {},
    onQuit = () => {},
  } = {}) {
    this.platform = platform;
    this.win = win;
    this.app = app;
    this.Tray = Tray;
    this.Menu = Menu;
    this.icons = icons;
    this.onAction = onAction;
    this.onWindowAction = onWindowAction;
    this.onRestore = onRestore;
    this.onQuit = onQuit;
    this.tray = null;
    this.state = {};
    this.thumbarConfigured = false;
  }

  init() {
    if (this.Tray && this.icons.tray) {
      try {
        this.tray = new this.Tray(this.icons.tray);
        this.tray.setToolTip(formatTooltip(this.state));
        this.tray.on('click', () => this.toggleWindow());
      } catch (error) {
        console.warn('System tray initialization skipped:', error.message);
        this.tray = null;
      }
    }
    this.update(this.state);
  }

  toggleWindow() {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.win.isVisible() && !this.win.isMinimized() && this.win.isFocused()) {
      this.win.minimize();
    } else {
      this.onRestore();
    }
  }

  update(state = {}) {
    this.state = { ...this.state, ...state };
    this.updateTray();
    this.updateThumbar();
    this.updateDock();
  }

  updateTray() {
    if (!this.tray || !this.Menu) return;
    try {
      const isMinimized = Boolean(this.win && !this.win.isDestroyed() && this.win.isMinimized());
      const template = buildTrayMenuTemplate({
        state: this.state,
        onAction: this.onAction,
        onWindowAction: this.onWindowAction,
        onRestore: () => this.toggleWindow(),
        onQuit: this.onQuit,
        isMinimized,
      });
      this.tray.setToolTip(formatTooltip(this.state));
      this.tray.setContextMenu(this.Menu.buildFromTemplate(template));
    } catch (error) {
      console.warn('Tray update skipped:', error.message);
    }
  }

  updateThumbar() {
    if (this.platform !== 'win32' || !this.win || this.win.isDestroyed() || !this.icons.play) return;
    try {
      const tooltip = formatTooltip(this.state);
      if (typeof this.win.setThumbnailToolTip === 'function') {
        this.win.setThumbnailToolTip(tooltip);
      }
      if (typeof this.win.setThumbarButtons === 'function') {
        const buttons = buildThumbarButtons({
          state: this.state,
          icons: this.icons,
          onAction: this.onAction,
        });
        this.win.setThumbarButtons(buttons);
        this.thumbarConfigured = true;
      }
    } catch (error) {
      console.warn('Thumbar update skipped:', error.message);
    }
  }

  updateDock() {
    if (this.platform !== 'darwin' || !this.app?.dock?.setMenu || !this.Menu) return;
    try {
      const template = buildDockMenuTemplate({
        state: this.state,
        onAction: this.onAction,
        onWindowAction: this.onWindowAction,
        onRestore: this.onRestore,
      });
      this.app.dock.setMenu(this.Menu.buildFromTemplate(template));
    } catch (error) {
      console.warn('Dock menu update skipped:', error.message);
    }
  }

  destroy() {
    if (this.tray) {
      try { this.tray.destroy(); } catch {}
      this.tray = null;
    }
  }
}

module.exports = {
  formatTooltip,
  buildTrayMenuTemplate,
  buildDockMenuTemplate,
  buildThumbarButtons,
  TaskbarController,
};
