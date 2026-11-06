import { initializeIcons, setIcon, icon } from './icons.js';
import { DemoPlayer } from './demo.js';

const $ = id => document.getElementById(id);
const bridge = window.pocket;
const state = {
  connected: false, demo: false, demoPlayer: null, tab: 'search', type: 'track',
  query: '', offset: 0, hasNext: false, loadingMore: false, playback: null, playbackAt: 0,
  saved: false, savedUri: null, settings: false, compact: false, pinned: true,
  busy: false, listVersion: 0, sessionVersion: 0, polling: false, nextPoll: 0,
  profile: null, features: null, featuresTrackUri: null,
  muted: false, unmutedVolume: 50,
  topKind: 'tracks', topRange: 'medium_term', customContext: null,
  renderedUris: new Set(),
  lyrics: null, lyricsTrackUri: null, activeLyricIndex: -1,
};
let searchTimer;
let toastTimer;
let loginPending = false;
initializeIcons();

function musicKey(key, mode) {
  if (key == null || key < 0 || key > 11) return '';
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[key]} ${mode === 1 ? 'Maj' : 'Min'}`;
}

function musicMood(valence = 0.5, energy = 0.5) {
  if (energy > 0.7 && valence > 0.6) return 'Uplifting';
  if (energy > 0.7 && valence <= 0.6) return 'Intense';
  if (energy <= 0.4 && valence <= 0.4) return 'Melancholic';
  if (energy <= 0.5 && valence > 0.5) return 'Mellow';
  return 'Dynamic';
}

function time(ms) { const seconds = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function usable() { return state.connected || state.demo; }
function action(name, args) {
  if (state.demo) return state.demoPlayer.action(name, args);
  if (!state.connected) return Promise.reject(new Error('Connect Spotify in Settings, or try the demo.'));
  return bridge.action(name, args);
}
function log(level, tag, ...args) {
  const fn = console[level] || console.log;
  fn(`[${tag}]`, ...args);
  if (bridge?.log) bridge.log(level, tag, ...args).catch(() => {});
}
function notify(message) {
  $('toast-text').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 8000);
}
function report(error) {
  if (error.status !== 403 && error.status !== 404) {
    log('error', 'Renderer', error.message || error);
  }
  notify(error.message || 'Something went wrong. Please try again.');
  state.nextPoll = Date.now() + Math.max(15, error.retryAfter || 0) * 1000;
}
function textElement(tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}
function iconButton(name, label, handler) {
  const button = document.createElement('button');
  button.className = 'icon-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  setIcon(button, name);
  button.addEventListener('click', handler);
  return button;
}
function artwork(item) { return item?.album?.images?.[0]?.url || item?.images?.[0]?.url || 'cover.svg'; }
function safeImage(img, src) {
  img.onerror = () => { img.onerror = null; img.src = 'cover.svg'; };
  if (img.getAttribute('src') !== src) img.src = src;
}
function details(item) {
  return item.artists?.map(artist => artist.name).join(', ') || item.show?.publisher || item.owner?.display_name || (item.type === 'artist' ? 'Artist' : 'Spotify');
}
function setActive(id, active) { $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active)); }

async function loadProfile() {
  if (!usable()) {
    $('user-badge').hidden = true;
    return;
  }
  try {
    const profile = await action('profile');
    state.profile = profile;
    const tier = (profile?.product || (state.demo ? 'premium' : '')).toUpperCase();
    if (tier) {
      $('user-badge').textContent = tier;
      $('user-badge').hidden = false;
      $('user-badge').classList.toggle('free', tier === 'FREE');
      $('user-badge').title = `Spotify ${tier} (${profile.display_name || 'Listener'})`;
    }
  } catch (error) {
    log('debug', 'Profile', error.message);
  }
}

async function loadAudioFeatures(item) {
  if (!item?.id || item.type !== 'track' || !usable()) {
    $('audio-features').hidden = true;
    return;
  }
  if (state.featuresTrackUri === item.uri) return;
  state.featuresTrackUri = item.uri;
  try {
    const feat = await action('audio-features', {
      id: item.id,
      title: item.name,
      artist: details(item),
    });
    if (!feat || state.featuresTrackUri !== item.uri) return;
    state.features = feat;
    const keyLabel = feat.keyText || musicKey(feat.key, feat.mode) || 'Key —';
    $('feature-bpm').textContent = `${Math.round(feat.tempo || 120)} BPM`;
    $('feature-key').textContent = keyLabel;
    $('feature-mood').textContent = musicMood(feat.valence, feat.energy);
    $('audio-features').hidden = false;

    const glow = feat.valence > 0.5
      ? `rgba(200, 237, 170, ${(0.06 + (feat.energy || 0.5) * 0.1).toFixed(2)})`
      : `rgba(145, 120, 230, ${(0.08 + (feat.energy || 0.5) * 0.1).toFixed(2)})`;
    document.documentElement.style.setProperty('--ambient-glow', glow);
    const bpm = Math.max(50, Math.min(220, feat.tempo || 120));
    document.documentElement.style.setProperty('--bpm-duration', `${(60 / bpm).toFixed(2)}s`);
  } catch (error) {
    $('audio-features').hidden = true;
  }
}

async function startRadio(item) {
  if (!item?.id) return;
  empty('Tuning in…', `Finding tracks matching ${item.name}.`, 'radio');
  try {
    const result = await action('recommendations', {
      seedTracks: item.id,
      seedArtists: item.artists?.[0]?.id || undefined,
      limit: 20,
    });
    const tracks = result?.tracks || [];
    state.tab = 'search';
    state.customContext = { type: 'radio', title: `Radio · ${item.name}`, items: tracks };
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'search'));
    $('search-tools').hidden = true;
    $('list-tools').hidden = false;
    $('library-kind').hidden = true;
    $('top-tools').hidden = true;
    $('list-title').textContent = `Radio · ${item.name}`;
    renderItems(tracks);
    notify(`Tuned 20 recommendations based on ${item.name}.`);
  } catch (error) {
    report(error);
  }
}

async function loadAlbumTracks(albumId, albumName) {
  empty('Loading album…', albumName, 'library');
  try {
    const result = await action('album-tracks', { id: albumId });
    const tracks = (result?.items || []).map(t => ({ ...t, album: { id: albumId, name: albumName } }));
    state.customContext = { type: 'album', id: albumId, title: albumName, items: tracks };
    $('search-tools').hidden = true;
    $('list-tools').hidden = false;
    $('library-kind').hidden = true;
    $('top-tools').hidden = true;
    $('list-title').textContent = albumName;
    renderItems(tracks);
  } catch (error) {
    report(error);
  }
}

async function loadArtistTopTracks(artistId, artistName) {
  empty('Loading artist…', artistName, 'music');
  try {
    const result = await action('artist-top-tracks', { id: artistId });
    const tracks = result?.tracks || [];
    state.customContext = { type: 'artist', id: artistId, title: artistName, items: tracks };
    $('search-tools').hidden = true;
    $('list-tools').hidden = false;
    $('library-kind').hidden = true;
    $('top-tools').hidden = true;
    $('list-title').textContent = `${artistName} · Top songs`;
    renderItems(tracks);
  } catch (error) {
    report(error);
  }
}

async function loadLyrics() {
  const item = state.playback?.item;
  if (!item?.name) {
    $('lyrics-lines').innerHTML = '<div class="lyrics-empty">Play a song to view lyrics.</div>';
    return;
  }
  if (state.lyricsTrackUri === item.uri && state.lyrics) {
    renderLyrics(state.lyrics);
    return;
  }
  state.lyricsTrackUri = item.uri;
  state.activeLyricIndex = -1;
  $('lyrics-lines').innerHTML = '<div class="lyrics-empty">Looking up lyrics…</div>';
  try {
    let result;
    if (state.demo) {
      result = await action('lyrics');
    } else if (bridge?.lyrics) {
      result = await bridge.lyrics({
        trackName: item.name,
        artistName: details(item),
        albumName: item.album?.name,
        duration: item.duration_ms,
      });
    }
    if (state.lyricsTrackUri !== item.uri) return;
    state.lyrics = result;
    renderLyrics(result);
  } catch (error) {
    $('lyrics-lines').innerHTML = '<div class="lyrics-empty">No lyrics found for this track.</div>';
  }
}

function renderLyrics(lyrics) {
  if (!lyrics?.lines?.length) {
    $('lyrics-lines').innerHTML = '<div class="lyrics-empty">No lyrics available for this song.</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  lyrics.lines.forEach((line, index) => {
    const el = document.createElement('div');
    el.className = 'lyric-line';
    el.dataset.index = String(index);
    el.textContent = line.text;
    if (line.time != null) {
      el.title = `Jump to ${time(line.time * 1000)}`;
      el.addEventListener('click', () => {
        command('seek', { position: Math.round(line.time * 1000) });
      });
    }
    fragment.append(el);
  });
  $('lyrics-lines').replaceChildren(fragment);
  updateActiveLyric();
}

function updateActiveLyric() {
  if (state.tab !== 'lyrics' || !state.lyrics?.synced || !state.lyrics?.lines?.length) return;
  const p = state.playback;
  const progressSec = Math.min(p?.item?.duration_ms || 0, (p?.progress_ms || 0) + (p?.is_playing ? Date.now() - state.playbackAt : 0)) / 1000;

  const lines = state.lyrics.lines;
  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time != null && lines[i].time <= progressSec) {
      activeIndex = i;
    } else if (lines[i].time != null && lines[i].time > progressSec) {
      break;
    }
  }

  if (activeIndex !== state.activeLyricIndex) {
    state.activeLyricIndex = activeIndex;
    const all = $('lyrics-lines').querySelectorAll('.lyric-line');
    all.forEach((el, idx) => el.classList.toggle('active', idx === activeIndex));
    if (activeIndex >= 0 && all[activeIndex]) {
      all[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function renderPlayback() {
  const p = state.playback;
  const item = p?.item;
  const device = p?.device;
  const enabled = usable() && Boolean(device) && !device.is_restricted && !state.busy;
  const disallows = p?.actions?.disallows || {};
  $('track-link').textContent = item?.name || (usable() ? 'Ready when you are.' : 'A little space for music.');
  $('track-link').title = item?.name ? `${item.name} · Open in Spotify` : 'Open Spotify';
  $('artist').textContent = item ? details(item) : usable() ? 'Open Spotify and start a song' : 'Connect Spotify to get started';
  safeImage($('cover'), artwork(item));
  $('playing-label').textContent = state.demo ? 'DEMO · NO AUDIO' : p?.is_playing ? 'NOW PLAYING' : item ? 'TAKE YOUR TIME' : 'YOUR MUSIC, WITHIN REACH';
  $('playing-dot').classList.toggle('playing', Boolean(p?.is_playing));
  loadAudioFeatures(item);
  $('duration').textContent = time(item?.duration_ms);
  $('seek').max = Math.max(1, item?.duration_ms || 1);
  $('seek').disabled = !enabled || !item || disallows.seeking === true;
  $('device-name').textContent = device?.name || 'Choose a device';
  $('volume').disabled = !enabled || device?.supports_volume === false || device?.volume_percent == null;
  if (document.activeElement !== $('volume')) $('volume').value = device?.volume_percent ?? 50;
  const vol = device?.volume_percent ?? 50;
  $('mute').disabled = !enabled || device?.supports_volume === false;
  const isMuted = vol === 0 || state.muted;
  $('mute').classList.toggle('muted', isMuted);
  setIcon($('mute'), isMuted ? 'volumeMute' : 'volume');
  $('mute').title = isMuted ? 'Unmute (M)' : 'Mute (M)';
  $('save').disabled = !usable() || !item?.uri || item.is_local || !['track', 'episode'].includes(item.type) || state.busy;
  setActive('save', state.saved);
  const saveLabel = state.saved ? 'Remove from your library' : 'Save to your library';
  $('save').title = saveLabel; $('save').setAttribute('aria-label', saveLabel);
  $('play').disabled = !enabled || (p?.is_playing ? disallows.pausing : disallows.resuming) === true;
  const label = p?.is_playing ? 'Pause' : 'Play';
  setIcon($('play'), p?.is_playing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', label); $('play').title = `${label} (Space)`;
  $('previous').disabled = !enabled || disallows.skipping_prev === true;
  $('next').disabled = !enabled || disallows.skipping_next === true;
  $('shuffle').disabled = !enabled || disallows.toggling_shuffle === true;
  $('repeat').disabled = !enabled || disallows.toggling_repeat_context === true || disallows.toggling_repeat_track === true;
  setActive('shuffle', Boolean(p?.shuffle_state));
  setActive('repeat', Boolean(p?.repeat_state && p.repeat_state !== 'off'));
  setIcon($('repeat'), p?.repeat_state === 'track' ? 'repeatOne' : 'repeat');
  const repeatLabel = `Repeat ${p?.repeat_state || 'off'}`;
  $('repeat').title = repeatLabel; $('repeat').setAttribute('aria-label', repeatLabel);
  $('connection-status').textContent = state.demo ? 'Demo · no audio' : state.connected ? 'Connected' : 'Not connected';
  $('demo-badge').hidden = !state.demo;
  updateProgress();
  syncNativeControls();
  if (p?.item && p.is_playing && state.lastLoggedTrack !== p.item.uri) {
    state.lastLoggedTrack = p.item.uri;
    log('info', 'Player', `▶ Playing "${p.item.name}" by ${details(p.item)}`);
  }
  if (state.tab === 'lyrics' && p?.item && state.lyricsTrackUri !== p.item.uri) {
    loadLyrics();
  }
}

let lastSyncedJson = '';
function syncNativeControls() {
  const p = state.playback;
  const item = p?.item;
  const device = p?.device;
  const enabled = usable() && Boolean(device) && !device.is_restricted && !state.busy;
  const disallows = p?.actions?.disallows || {};

  if ('mediaSession' in navigator) {
    if (item) {
      const art = artwork(item);
      const isRemoteArt = typeof art === 'string' && art.startsWith('http');
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.name || '',
        artist: details(item),
        album: item.album?.name || '',
        artwork: isRemoteArt ? [{ src: art }] : [],
      });
    } else {
      navigator.mediaSession.metadata = null;
    }
    navigator.mediaSession.playbackState = p?.is_playing ? 'playing' : (item ? 'paused' : 'none');
  }

  const audio = $('mpris-audio');
  if (audio) {
    if (p?.is_playing) {
      if (audio.paused) audio.play().catch(() => {});
    } else {
      if (!audio.paused) audio.pause();
    }
  }

  if (bridge?.syncPlayback) {
    const payload = {
      title: item?.name || null,
      artist: item ? details(item) : null,
      uri: item?.uri || null,
      isPlaying: Boolean(p?.is_playing),
      isSaved: Boolean(state.saved),
      shuffle: Boolean(p?.shuffle_state),
      repeat: p?.repeat_state || 'off',
      volume: device?.volume_percent ?? 50,
      muted: Boolean(state.muted),
      unmutedVolume: state.unmutedVolume || 50,
      pinned: Boolean(state.pinned),
      compact: Boolean(state.compact),
      canPlayPause: Boolean(enabled && !(p?.is_playing ? disallows.pausing : disallows.resuming)),
      canNext: Boolean(enabled && !disallows.skipping_next),
      canPrevious: Boolean(enabled && !disallows.skipping_prev),
      canSave: Boolean(item?.uri && !item?.is_local && ['track', 'episode'].includes(item?.type)),
    };
    const json = JSON.stringify(payload);
    if (json !== lastSyncedJson) {
      lastSyncedJson = json;
      bridge.syncPlayback(payload).catch(() => {});
    }
  }
}

function updateProgress() {
  if (document.activeElement === $('seek')) return;
  const p = state.playback;
  const progress = Math.min(p?.item?.duration_ms || 0, (p?.progress_ms || 0) + (p?.is_playing ? Date.now() - state.playbackAt : 0));
  $('seek').value = progress;
  $('elapsed').textContent = time(progress);
  updateActiveLyric();
}

async function refreshPlayback() {
  if (!usable() || state.polling) return;
  state.polling = true;
  const version = state.sessionVersion;
  try {
    const playback = await action('playback');
    if (version !== state.sessionVersion) return;
    state.playback = playback;
    state.playbackAt = Date.now();
    const uri = playback?.item?.uri;
    const canSave = uri && !playback.item.is_local && ['track', 'episode'].includes(playback.item.type);
    if (uri !== state.savedUri) {
      state.saved = false;
      state.savedUri = uri;
      if (canSave) {
        try {
          const saved = await action('saved', { uri });
          if (version === state.sessionVersion && state.savedUri === uri) state.saved = Boolean(saved?.[0]);
        } catch (error) {
          if (version === state.sessionVersion) { state.savedUri = null; report(error); }
        }
      }
    }
    if (version === state.sessionVersion) {
      log('debug', 'Playback', {
        track: playback?.item?.name,
        artist: playback?.item ? details(playback.item) : null,
        isPlaying: playback?.is_playing,
        device: playback?.device?.name || 'No active device',
      });
      renderPlayback();
    }
  } catch (error) {
    if (version === state.sessionVersion) {
      report(error);
      if (!state.demo && bridge) {
        const status = await bridge.status().catch(() => null);
        if (status && !status.connected && version === state.sessionVersion) {
          state.connected = false;
          resetSession();
          showSettings(true);
        }
      }
    }
  } finally { state.polling = false; }
}

async function command(name, args = {}, message) {
  if (state.busy) return;
  state.busy = true;
  const version = state.sessionVersion;
  log('info', 'Command', name, args);
  renderPlayback();
  try {
    let deviceId = state.playback?.device?.id || args.deviceId;

    if (!deviceId && ['play', 'next', 'previous'].includes(name) && !state.demo) {
      try {
        const devList = await action('devices');
        const devices = devList?.devices || [];
        const target = devices.find(d => /pocket/i.test(d.name))
          || devices.find(d => d.is_active)
          || devices.find(d => !d.is_restricted);
        if (target?.id) {
          deviceId = target.id;
          await action('transfer', { deviceId });
          log('info', 'Player', `Auto-selected playback device: ${target.name} (${target.id})`);
        }
      } catch (devErr) {
        log('debug', 'Player', 'Auto device selection failed:', devErr.message);
      }
    }

    await action(name, { deviceId, ...args });
    if (version !== state.sessionVersion) return;
    if (name === 'save' || name === 'unsave') state.saved = name === 'save';
    // Spotify commands settle asynchronously. Avoid displaying an immediate stale read.
    await new Promise(resolve => setTimeout(resolve, state.demo ? 0 : 500));
    await refreshPlayback();
    if (message) notify(message);
    if (['queue', 'devices', 'library'].includes(state.tab)) await loadList();
  } catch (error) {
    if (version === state.sessionVersion) {
      log('error', 'Command:Error', name, error.message || error);
      report(error);
    }
  } finally { state.busy = false; renderPlayback(); }
}

function empty(title, description, symbol = 'music', buttonLabel, handler) {
  const container = document.createElement('div');
  container.className = 'empty';
  const image = document.createElement('span'); image.innerHTML = icon(symbol); container.append(image);
  container.append(textElement('strong', '', title), textElement('p', '', description));
  if (buttonLabel) {
    const button = textElement('button', 'text-button', buttonLabel);
    button.addEventListener('click', handler);
    container.append(button);
  }
  $('results').replaceChildren(container);
}

function renderItems(items, append = false) {
  if (!append) state.renderedUris.clear();
  const fragment = document.createDocumentFragment();
  let count = 0;
  for (const item of items.filter(Boolean)) {
    const key = item.uri || (item.id ? `${item.type || 'track'}:${item.id}` : null);
    if (key && state.renderedUris.has(key)) continue;
    if (key) state.renderedUris.add(key);
    count++;

    const row = document.createElement('div'); row.className = 'result-row';
    if (item.uri === state.playback?.item?.uri) row.classList.add('current');
    const img = document.createElement('img'); img.className = 'result-art'; img.alt = ''; img.loading = 'lazy'; safeImage(img, artwork(item));
    const main = document.createElement('button'); main.className = 'result-main';
    const playable = item.is_playable !== false && !item.is_local && Boolean(item.uri);
    main.title = playable ? `Play ${item.name}` : 'This item is unavailable';
    main.disabled = !playable;
    main.append(textElement('span', 'result-name', item.name || 'Unavailable item'), textElement('span', 'result-detail', details(item)));
    
    if (item.type === 'album') {
      main.title = `Open album: ${item.name}`;
      main.addEventListener('click', () => loadAlbumTracks(item.id, item.name));
    } else if (item.type === 'artist') {
      main.title = `View artist: ${item.name}`;
      main.addEventListener('click', () => loadArtistTopTracks(item.id, item.name));
    } else {
      const contextUri = ['track', 'episode'].includes(item.type) ? item.album?.uri : undefined;
      main.addEventListener('click', () => command('play', { uri: item.uri, contextUri }));
    }
    row.append(img, main);
    if (item.duration_ms) row.append(textElement('span', 'result-duration', time(item.duration_ms)));
    if (['track', 'episode'].includes(item.type)) {
      const radio = iconButton('radio', `Start Song Radio from ${item.name}`, () => startRadio(item));
      const queue = iconButton('plus', `Add ${item.name} to queue`, () => command('enqueue', { uri: item.uri }, 'Added to your queue.'));
      radio.disabled = !playable;
      queue.disabled = !playable;
      row.append(radio, queue);
    } else {
      const play = iconButton('play', `Play ${item.name}`, () => command('play', { uri: item.uri }));
      play.disabled = !playable;
      row.append(play);
    }
    fragment.append(row);
  }
  if (append) {
    $('results').append(fragment);
  } else {
    $('results').replaceChildren(fragment);
  }
  return count;
}

function renderDevices(devices) {
  if (!devices.length) {
    empty('Let’s find your Spotify.', 'Open Spotify on your computer or phone and play a song. Then refresh this list.', 'device', 'Open Spotify ↗', () => openLink('spotify'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const device of devices) {
    const row = document.createElement('div'); row.className = `result-row${device.is_active ? ' current' : ''}`;
    const symbol = document.createElement('span'); symbol.innerHTML = icon('device');
    const main = document.createElement('button'); main.className = 'result-main';
    main.disabled = device.is_restricted || !device.id;
    main.append(textElement('span', 'result-name', device.name), textElement('span', 'result-detail', device.is_restricted ? 'Control unavailable on this device' : device.is_active ? 'Currently listening here' : `Switch to this ${device.type.toLowerCase()}`));
    main.addEventListener('click', () => command('transfer', { deviceId: device.id }, `Selected ${device.name}. Press play to listen.`));
    row.append(symbol, main);
    if (device.is_active) { const check = document.createElement('span'); check.innerHTML = icon('check'); row.append(check); }
    fragment.append(row);
  }
  $('results').replaceChildren(fragment);
}

async function loadList({ append = false } = {}) {
  const version = ++state.listVersion;
  state.loadingMore = append;
  const isLyrics = state.tab === 'lyrics';
  $('lyrics-container').hidden = !isLyrics;
  $('results').hidden = isLyrics;

  if (isLyrics) {
    state.offset = 0;
    state.customContext = null;
    $('load-more-container').hidden = true;
    $('search-tools').hidden = true;
    $('list-tools').hidden = true;
    loadLyrics();
    return;
  }

  if (!append) {
    state.offset = 0;
    state.customContext = null;
    state.renderedUris.clear();
    $('load-more-container').hidden = true;
    $('search-tools').hidden = state.tab !== 'search';
    $('list-tools').hidden = state.tab === 'search';
    $('library-kind').hidden = state.tab !== 'library';
    $('top-tools').hidden = state.tab !== 'top';
    $('list-title').textContent = {
      library: 'Your library',
      queue: 'Coming up next',
      recent: 'Recently played',
      top: state.topKind === 'artists' ? 'Top artists' : 'Top songs',
      devices: 'Listen on',
    }[state.tab] || '';
    if (!usable()) {
      empty('Your Spotify, a little closer.', 'Connect your account to search, play, and collect your favorites.', 'music', 'Connect Spotify →', () => showSettings(true));
      return;
    }
    if (state.tab === 'search' && !state.query.trim()) {
      empty(state.demo ? 'Meet your new little player.' : 'Find your next favorite.', state.demo ? 'Try “Soft Focus”, explore your library, or choose a different device. This demo uses fictional music.' : 'Search songs, albums, artists, and playlists without losing your place.', 'search');
      return;
    }
    empty('One moment…', 'Finding your music.', 'search');
  } else {
    $('load-more').disabled = true;
    $('load-more').textContent = 'Loading more songs…';
  }

  try {
    let result;
    let items;
    const limit = state.tab === 'search' ? 10 : 20;
    if (state.tab === 'search') {
      result = (await action('search', { query: state.query.trim(), type: state.type, offset: state.offset, limit }))[`${state.type}s`];
      items = result?.items || [];
    } else if (state.tab === 'library') {
      const kind = $('library-kind').value;
      result = await action(kind, { offset: state.offset, limit });
      if (kind === 'following') {
        items = result?.artists?.items || [];
      } else {
        items = (result?.items || []).map(item => item.track || item.album || item.item || item);
      }
    } else if (state.tab === 'queue') {
      items = (await action('queue'))?.queue || [];
    } else if (state.tab === 'recent') {
      result = await action('recently-played', { limit: 50 });
      items = (result?.items || []).map(i => i.track || i);
    } else if (state.tab === 'top') {
      const topAction = state.topKind === 'artists' ? 'top-artists' : 'top-tracks';
      result = await action(topAction, { timeRange: state.topRange, limit, offset: state.offset });
      items = result?.items || [];
    } else {
      result = await action('devices');
      if (version === state.listVersion) renderDevices(result?.devices || []);
      return;
    }
    if (version !== state.listVersion) return;
    const validItems = items.filter(Boolean);
    const renderedCount = renderItems(validItems, append);
    state.offset += validItems.length;

    if (!append && !renderedCount) {
      const emptyMessages = {
        search: ['Nothing here just yet.', 'Try a different name or search category.'],
        queue: ['A little room for something good.', 'Use + beside a song to add it to your queue.'],
        recent: ['No recent tracks found.', 'Play songs in Spotify and check back here.'],
        top: ['No top tracks recorded.', 'Listen to more music to populate your charts.'],
        library: ['Your collection starts here.', 'Save a song or playlist in Spotify and refresh this list.'],
      };
      const [title, desc] = emptyMessages[state.tab] || emptyMessages.library;
      empty(title, desc);
    }
    if (!append) $('results').scrollTop = 0;
    const paginatedTab = ['search', 'library', 'top'].includes(state.tab) && $('library-kind').value !== 'following';
    state.hasNext = paginatedTab && Boolean(result?.next) && renderedCount > 0;
    $('load-more-container').hidden = !state.hasNext;
    $('load-more').disabled = false;
    $('load-more').textContent = 'Load more songs ↓';
  } catch (error) {
    if (version !== state.listVersion) return;
    if (!append) empty('Couldn’t load your music.', error.message, 'refresh', 'Try again', () => loadList());
    else notify(error.message || 'Could not load more songs.');
  } finally {
    state.loadingMore = false;
  }
}

function switchTab(tab) {
  state.tab = tab;
  state.offset = 0;
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  showSettings(false);
}

function showSettings(show) {
  state.settings = show;
  document.body.classList.toggle('settings-open', show && !state.compact);
  $('settings').hidden = !show;
  $('browse').hidden = show;
  if (show) {
    $('connect-form').hidden = state.connected;
    $('connected-settings').hidden = !state.connected;
    $('try-demo').textContent = state.demo ? 'Leave demo →' : 'Just looking? Try the demo →';
  } else loadList();
}

async function openLink(link) {
  if (state.demo && link.startsWith('spotify:')) { notify('This is a fictional demo song. Connect Spotify to open real music.'); return; }
  try {
    if (bridge) await bridge.open(link);
    else {
      const links = { spotify: 'https://open.spotify.com', dashboard: 'https://developer.spotify.com/dashboard', access: 'https://developer.spotify.com/documentation/web-api/concepts/quota-modes' };
      if (links[link]) window.open(links[link], '_blank', 'noopener,noreferrer');
    }
  } catch (error) { report(error); }
}

async function windowAction(name) {
  try {
    if (!bridge && ['minimize', 'close', 'pin'].includes(name)) { notify('Window controls work in the desktop app.'); return; }
    const next = bridge ? await bridge.window(name) : { compact: !state.compact, pinned: state.pinned };
    state.compact = next.compact; state.pinned = next.pinned;
    document.body.classList.toggle('compact', state.compact);
    setActive('pin', state.pinned); setActive('compact', state.compact);
    setIcon($('compact'), state.compact ? 'expand' : 'collapse');
    const label = state.compact ? 'Expand player' : 'Collapse player';
    $('compact').title = label; $('compact').setAttribute('aria-label', label);
    if (state.settings && state.compact) showSettings(false);
  } catch (error) { report(error); }
}

function resetSession() {
  state.sessionVersion++;
  state.listVersion++;
  state.playback = null;
  state.savedUri = null;
  state.saved = false;
  state.nextPoll = 0;
  renderPlayback();
}

function toggleMute() {
  if (!usable() || !state.playback?.device?.supports_volume) return;
  const current = Number($('volume').value) || 0;
  if (state.muted || current === 0) {
    state.muted = false;
    const restore = state.unmutedVolume || 50;
    command('volume', { volume: restore });
    $('mute').classList.remove('muted');
    setIcon($('mute'), 'volume');
  } else {
    state.muted = true;
    state.unmutedVolume = current;
    command('volume', { volume: 0 });
    $('mute').classList.add('muted');
    setIcon($('mute'), 'volumeMute');
  }
}

for (const name of ['pin', 'compact', 'minimize', 'close']) $(name).addEventListener('click', () => windowAction(name));
$('dismiss-toast').addEventListener('click', () => { $('toast').hidden = true; });
$('play').addEventListener('click', () => command(state.playback?.is_playing ? 'pause' : 'play'));
for (const name of ['previous', 'next']) $(name).addEventListener('click', () => command(name));
$('shuffle').addEventListener('click', () => command('shuffle', { enabled: !state.playback?.shuffle_state }));
$('repeat').addEventListener('click', () => command('repeat', { mode: { off: 'context', context: 'track', track: 'off' }[state.playback?.repeat_state || 'off'] }));
$('save').addEventListener('click', () => command(state.saved ? 'unsave' : 'save', { uri: state.playback.item.uri }, state.saved ? 'Removed from your library.' : 'Saved to your library.'));
$('seek').addEventListener('input', () => { $('elapsed').textContent = time(Number($('seek').value)); });
$('seek').addEventListener('change', () => command('seek', { position: Math.round(Number($('seek').value)) }));
$('volume').addEventListener('change', () => {
  state.muted = false;
  $('mute').classList.remove('muted');
  setIcon($('mute'), 'volume');
  command('volume', { volume: Number($('volume').value) });
});
$('mute').addEventListener('click', toggleMute);

const playerCard = document.querySelector('.player');
if (playerCard) {
  playerCard.addEventListener('wheel', event => {
    if (!usable() || state.playback?.device?.supports_volume === false) return;
    event.preventDefault();
    const current = Number($('volume').value) || 0;
    const delta = event.deltaY < 0 ? 5 : -5;
    const nextVol = Math.max(0, Math.min(100, current + delta));
    if (nextVol !== current) {
      $('volume').value = nextVol;
      state.muted = nextVol === 0;
      $('mute').classList.toggle('muted', state.muted);
      setIcon($('mute'), state.muted ? 'volumeMute' : 'volume');
      command('volume', { volume: nextVol });
    }
  }, { passive: false });
}
$('song-radio').addEventListener('click', () => { if (state.playback?.item) startRadio(state.playback.item); });
$('device-shortcut').addEventListener('click', () => switchTab('devices'));
for (const name of ['track-link', 'cover-link']) $(name).addEventListener('click', () => openLink(state.playback?.item?.uri || 'spotify'));
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
  state.type = button.dataset.type; state.offset = 0;
  document.querySelectorAll('[data-type]').forEach(filter => { filter.classList.toggle('active', filter === button); filter.setAttribute('aria-pressed', String(filter === button)); });
  loadList();
}));
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  state.query = $('search').value; state.offset = 0; state.listVersion++;
  searchTimer = setTimeout(loadList, 350);
});
$('library-kind').addEventListener('change', () => { state.offset = 0; loadList(); });
$('top-kind').addEventListener('change', () => { state.topKind = $('top-kind').value; state.offset = 0; loadList(); });
$('top-range').addEventListener('change', () => { state.topRange = $('top-range').value; state.offset = 0; loadList(); });
$('refresh-list').addEventListener('click', loadList);
function loadMore() {
  if (state.busy || state.loadingMore || !state.hasNext) return;
  loadList({ append: true });
}
$('load-more').addEventListener('click', loadMore);
$('results').addEventListener('scroll', () => {
  if (state.hasNext && !state.loadingMore && !state.busy) {
    const { scrollTop, scrollHeight, clientHeight } = $('results');
    if (scrollTop + clientHeight >= scrollHeight - 60) {
      loadMore();
    }
  }
});
$('settings-toggle').addEventListener('click', () => showSettings(!state.settings));
$('settings-back').addEventListener('click', () => showSettings(false));
for (const name of ['dashboard', 'access']) $(name).addEventListener('click', () => openLink(name));
$('spotify-link').addEventListener('click', () => openLink('spotify'));

$('connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!bridge) { notify('Run the desktop app to connect your Spotify account.'); return; }
  const rawId = $('client-id').value.trim() || state.configuredClientId || '';
  if (!rawId) {
    $('client-id-field').hidden = false;
    $('client-id').focus();
    notify('Please enter your 32-character Spotify Client ID.');
    return;
  }
  if (loginPending) return;
  loginPending = true;
  $('connect').disabled = true;
  $('connect').textContent = 'Finish sign-in in your browser…';
  $('cancel-login').hidden = false;
  $('try-demo').disabled = true;
  try {
    const status = await bridge.connect(rawId);
    state.connected = status.connected; state.demo = false;
    resetSession();
    updateSessionNote(status);
    showSettings(false);
    await loadProfile();
    await refreshPlayback();
    notify('You’re connected. Open Spotify and choose where to listen.');
  } catch (error) { report(error); }
  finally {
    loginPending = false;
    $('connect').disabled = false;
    $('connect').textContent = 'Connect with Spotify →';
    $('cancel-login').hidden = true;
    $('try-demo').disabled = false;
  }
});
$('toggle-custom-id').addEventListener('click', () => {
  const isHidden = $('client-id-field').hidden;
  $('client-id-field').hidden = !isHidden;
  $('toggle-custom-id').textContent = isHidden ? 'Hide Client ID' : 'Custom Client ID ⚙';
  if (isHidden) $('client-id').focus();
});
$('cancel-login').addEventListener('click', () => bridge?.cancelLogin().catch(report));
$('disconnect').addEventListener('click', async () => {
  try {
    await bridge.disconnect();
    state.connected = false; state.demo = false;
    resetSession(); showSettings(true); notify('Spotify disconnected from Pocket.');
  } catch (error) { report(error); }
});
$('try-demo').addEventListener('click', async () => {
  state.demo = !state.demo;
  if (state.demo) state.demoPlayer = new DemoPlayer();
  resetSession();
  showSettings(!usable());
  await loadProfile();
  await refreshPlayback();
});

document.addEventListener('keydown', async event => {
  if (event.target.closest('input, select, textarea, button') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.code === 'Space') { event.preventDefault(); if (!$('play').disabled) $('play').click(); }
  if (event.code === 'KeyM') { event.preventDefault(); toggleMute(); }
  if (event.key === '/') {
    event.preventDefault();
    if (state.compact) await windowAction('compact');
    switchTab('search'); $('search').focus();
  }
  if (event.key === 'Escape') { $('toast').hidden = true; showSettings(false); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { state.nextPoll = 0; refreshPlayback(); } });

function updateSessionNote(status) {
  $('session-note').textContent = status.persistent ? 'Your connection is stored using your operating system’s encrypted storage.' : 'Your connection lasts for this session. Enable your system keyring to stay signed in.';
}
async function initialize() {
  try {
    if (bridge?.onRemoteAction) {
      bridge.onRemoteAction((action, args) => {
        if (action === 'playpause') command(state.playback?.is_playing ? 'pause' : 'play');
        else command(action, args);
      });
    }
    if (bridge?.onWindowState) {
      bridge.onWindowState(({ compact, pinned }) => {
        state.compact = compact;
        state.pinned = pinned;
        document.body.classList.toggle('compact', state.compact);
        setActive('pin', state.pinned);
        setActive('compact', state.compact);
        setIcon($('compact'), state.compact ? 'expand' : 'collapse');
        const label = state.compact ? 'Expand player' : 'Collapse player';
        $('compact').title = label;
        $('compact').setAttribute('aria-label', label);
        if (state.settings && state.compact) showSettings(false);
      });
    }
    if (bridge?.onSoloistStatus) {
      bridge.onSoloistStatus(connected => {
        $('soloist-badge').hidden = !connected;
        if (connected) notify('Spotify Soloist connected (Local audio active)');
      });
    }
    if (bridge?.onRemotePlayback) {
      bridge.onRemotePlayback(p => {
        state.playback = p;
        state.playbackAt = Date.now();
        renderPlayback();
      });
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => command('play'));
      navigator.mediaSession.setActionHandler('pause', () => command('pause'));
      navigator.mediaSession.setActionHandler('previoustrack', () => command('previous'));
      navigator.mediaSession.setActionHandler('nexttrack', () => command('next'));
      navigator.mediaSession.setActionHandler('seekto', details => {
        if (details.seekTime != null && state.playback?.item?.duration_ms) {
          command('seek', { position: Math.round(details.seekTime * 1000) });
        }
      });
    }
    const status = bridge ? await bridge.status() : { demo: true, connected: false, pinned: true, persistent: false };
    state.connected = status.connected; state.demo = status.demo; state.pinned = status.pinned;
    $('soloist-badge').hidden = !status.soloist;
    if ($('enable-receiver')) $('enable-receiver').checked = Boolean(status.enableReceiver);
    $('enable-receiver')?.addEventListener('change', async () => {
      const enabled = $('enable-receiver').checked;
      try {
        await bridge?.toggleReceiver?.(enabled);
        notify(enabled ? 'Connect receiver enabled.' : 'Connect receiver disabled.');
      } catch (err) {
        notify(err.message || 'Could not update receiver setting.');
      }
    });
    bridge?.onUpdateAvailable?.(info => {
      if ($('update-text')) $('update-text').textContent = `Version ${info.version} downloading…`;
      if ($('update-banner')) $('update-banner').hidden = false;
    });
    bridge?.onUpdateDownloaded?.(info => {
      if ($('update-text')) $('update-text').textContent = `Version ${info.version} ready.`;
      if ($('update-banner')) $('update-banner').hidden = false;
      notify(`Version ${info.version} is ready to install.`);
    });
    $('restart-update')?.addEventListener('click', () => {
      bridge?.installUpdate?.();
    });
    if (state.demo) state.demoPlayer = new DemoPlayer();
    state.configuredClientId = status.clientId || '';
    $('client-id').value = status.clientId || '';
    if (status.clientId) {
      $('client-id-field').hidden = true;
      $('toggle-custom-id').hidden = false;
    } else {
      $('client-id-field').hidden = false;
      $('toggle-custom-id').hidden = true;
    }
    setActive('pin', state.pinned);
    updateSessionNote(status);
    renderPlayback();
    showSettings(!usable());
    await loadProfile();
    await refreshPlayback();
  } catch (error) { report(error); showSettings(true); }
}
setInterval(() => {
  if (!document.hidden) updateProgress();
  if (!state.busy && usable() && Date.now() >= state.nextPoll) {
    state.nextPoll = Date.now() + 5000;
    refreshPlayback();
  }
}, 1000);
initialize();
