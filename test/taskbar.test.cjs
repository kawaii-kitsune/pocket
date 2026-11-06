const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatTooltip,
  buildTrayMenuTemplate,
  buildDockMenuTemplate,
  buildThumbarButtons,
  TaskbarController,
} = require('../src/lib/taskbar.cjs');

test('formatTooltip produces standard and track-specific labels', () => {
  assert.equal(formatTooltip(), 'Pocket · Spotify companion');
  assert.equal(formatTooltip({}), 'Pocket · Spotify companion');
  assert.equal(formatTooltip({ title: 'Song', artist: 'Artist', isPlaying: true }), 'Song · Artist (Playing) · Pocket');
  assert.equal(formatTooltip({ title: 'Song', artist: 'Artist', isPlaying: false }), 'Song · Artist (Paused) · Pocket');
  assert.equal(formatTooltip({ title: 'Solo Track', isPlaying: true }), 'Solo Track (Playing) · Pocket');
});

test('buildTrayMenuTemplate builds appropriate menu items and handles clicks', () => {
  const actions = [];
  const windowActions = [];
  let restored = false;
  let quit = false;

  const template = buildTrayMenuTemplate({
    state: { title: 'Track 1', artist: 'Artist 1', uri: 'spotify:track:123', isPlaying: true, isSaved: false, shuffle: true, repeat: 'context', volume: 80, pinned: true, compact: false },
    onAction: (name, args) => actions.push({ name, args }),
    onWindowAction: action => windowActions.push(action),
    onRestore: () => { restored = true; },
    onQuit: () => { quit = true; },
    isMinimized: true,
  });

  assert.equal(template[0].label, 'Track 1 · Artist 1');
  assert.equal(template[0].enabled, false);
  assert.equal(template[1].type, 'separator');
  assert.equal(template[2].label, 'Pause');
  assert.equal(template[3].label, 'Next Track');
  assert.equal(template[4].label, 'Previous Track');
  assert.equal(template[5].label, '♡ Save to Liked Songs');

  // Volume
  assert.equal(template[7].label, 'Volume: 80%');
  assert.ok(template[7].submenu.length >= 5);

  // Shuffle & Repeat
  assert.equal(template[8].label, 'Shuffle');
  assert.equal(template[8].checked, true);
  assert.equal(template[9].label, 'Repeat (context)');

  // Window actions
  assert.equal(template[11].label, 'Always on Top');
  assert.equal(template[11].checked, true);
  assert.equal(template[12].label, 'Compact Player');
  assert.equal(template[12].checked, false);
  assert.equal(template[13].label, 'Restore Pocket');
  assert.equal(template[15].label, 'Quit Pocket');

  template[2].click();
  template[3].click();
  template[4].click();
  template[5].click();
  template[8].click();
  template[11].click();
  template[12].click();
  template[13].click();
  template[15].click();

  assert.equal(actions[0].name, 'pause');
  assert.equal(actions[1].name, 'next');
  assert.equal(actions[2].name, 'previous');
  assert.equal(actions[3].name, 'save');
  assert.deepEqual(actions[3].args, { uri: 'spotify:track:123' });
  assert.equal(actions[4].name, 'shuffle');
  assert.deepEqual(windowActions, ['pin', 'compact']);
  assert.equal(restored, true);
  assert.equal(quit, true);
});

test('buildTrayMenuTemplate adapts when paused, saved, or minimized state changes', () => {
  const template = buildTrayMenuTemplate({
    state: { title: 'Track 2', isPlaying: false, isSaved: true },
    isMinimized: false,
  });
  assert.equal(template[2].label, 'Play');
  assert.equal(template[5].label, '♥ In Liked Songs');
  assert.equal(template[13].label, 'Minimize Pocket');
});

test('buildDockMenuTemplate formats macOS dock items correctly', () => {
  const actions = [];
  const windowActions = [];
  let restored = false;
  const template = buildDockMenuTemplate({
    state: { title: 'Dock Track', artist: 'Band', isPlaying: true, isSaved: true, shuffle: false, pinned: false, compact: true },
    onAction: name => actions.push(name),
    onWindowAction: action => windowActions.push(action),
    onRestore: () => { restored = true; },
  });

  assert.equal(template[0].label, 'Dock Track · Band');
  assert.equal(template[2].label, 'Pause');
  assert.equal(template[3].label, 'Next Track');
  assert.equal(template[4].label, 'Previous Track');
  assert.equal(template[5].label, '♥ In Liked Songs');
  assert.equal(template[7].label, 'Shuffle');
  assert.equal(template[8].label, 'Always on Top');
  assert.equal(template[9].label, 'Compact Player');
  assert.equal(template[11].label, 'Restore Pocket');

  template[2].click();
  template[8].click();
  template[11].click();
  assert.deepEqual(actions, ['pause']);
  assert.deepEqual(windowActions, ['pin']);
  assert.equal(restored, true);
});

test('buildThumbarButtons maintains exactly 3 buttons and updates play/pause state', () => {
  const actions = [];
  const icons = { play: 'icon-play', pause: 'icon-pause', prev: 'icon-prev', next: 'icon-next' };

  const pausedButtons = buildThumbarButtons({
    state: { title: 'Song', isPlaying: false },
    icons,
    onAction: name => actions.push(name),
  });

  assert.equal(pausedButtons.length, 3);
  assert.equal(pausedButtons[0].tooltip, 'Previous Track');
  assert.equal(pausedButtons[0].icon, 'icon-prev');
  assert.deepEqual(pausedButtons[0].flags, []);

  assert.equal(pausedButtons[1].tooltip, 'Play');
  assert.equal(pausedButtons[1].icon, 'icon-play');

  assert.equal(pausedButtons[2].tooltip, 'Next Track');
  assert.equal(pausedButtons[2].icon, 'icon-next');

  pausedButtons[0].click();
  pausedButtons[1].click();
  pausedButtons[2].click();
  assert.deepEqual(actions, ['previous', 'play', 'next']);

  const playingButtons = buildThumbarButtons({
    state: { title: 'Song', isPlaying: true },
    icons,
    onAction: name => actions.push(name),
  });
  assert.equal(playingButtons[1].tooltip, 'Pause');
  assert.equal(playingButtons[1].icon, 'icon-pause');
  playingButtons[1].click();
  assert.equal(actions[actions.length - 1], 'pause');

  const emptyButtons = buildThumbarButtons({ state: {}, icons });
  assert.deepEqual(emptyButtons[0].flags, ['disabled']);
  assert.deepEqual(emptyButtons[1].flags, ['disabled']);
  assert.deepEqual(emptyButtons[2].flags, ['disabled']);
});

test('TaskbarController manages Tray, Windows Thumbar, and macOS Dock lifecycle', () => {
  const actions = [];
  let restoreCalled = false;
  let quitCalled = false;
  let trayDestroyed = false;

  class MockTray {
    constructor(icon) {
      this.icon = icon;
      this.tooltip = '';
      this.menu = null;
      this.events = {};
    }
    setToolTip(tip) { this.tooltip = tip; }
    setContextMenu(menu) { this.menu = menu; }
    on(event, handler) { this.events[event] = handler; }
    destroy() { trayDestroyed = true; }
  }

  const MockMenu = {
    buildFromTemplate: template => ({ template }),
  };

  const mockWin = {
    minimized: false,
    visible: true,
    focused: true,
    destroyed: false,
    tooltip: '',
    thumbarButtons: null,
    isMinimized() { return this.minimized; },
    isVisible() { return this.visible; },
    isFocused() { return this.focused; },
    isDestroyed() { return this.destroyed; },
    minimize() { this.minimized = true; this.focused = false; },
    setThumbnailToolTip(tip) { this.tooltip = tip; },
    setThumbarButtons(buttons) { this.thumbarButtons = buttons; return true; },
  };

  const mockApp = {
    dock: {
      menu: null,
      setMenu(menu) { this.menu = menu; },
    },
  };

  const controller = new TaskbarController({
    platform: 'win32',
    win: mockWin,
    app: mockApp,
    Tray: MockTray,
    Menu: MockMenu,
    icons: { tray: 'tray-icon', play: 'play-icon', pause: 'pause-icon', prev: 'prev-icon', next: 'next-icon' },
    onAction: name => actions.push(name),
    onRestore: () => { restoreCalled = true; mockWin.minimized = false; },
    onQuit: () => { quitCalled = true; },
  });

  controller.init();
  assert.ok(controller.tray);
  assert.equal(controller.tray.tooltip, 'Pocket · Spotify companion');
  assert.equal(mockWin.tooltip, 'Pocket · Spotify companion');
  assert.equal(mockWin.thumbarButtons.length, 3);

  // Toggle window minimizes if focused
  controller.tray.events.click();
  assert.equal(mockWin.isMinimized(), true);

  // Toggle window restores if minimized
  controller.tray.events.click();
  assert.equal(restoreCalled, true);
  assert.equal(mockWin.isMinimized(), false);

  // Updating state updates tooltip and thumbar
  controller.update({ title: 'New Song', artist: 'New Artist', isPlaying: true });
  assert.equal(controller.tray.tooltip, 'New Song · New Artist (Playing) · Pocket');
  assert.equal(mockWin.tooltip, 'New Song · New Artist (Playing) · Pocket');
  assert.equal(mockWin.thumbarButtons[1].tooltip, 'Pause');

  controller.destroy();
  assert.equal(trayDestroyed, true);
});
