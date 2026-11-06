const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) {
    const error = new Error(result.error);
    error.status = result.status;
    error.retryAfter = result.retryAfter;
    throw error;
  }
  return result.data;
};
contextBridge.exposeInMainWorld('pocket', {
  status: () => invoke('pocket:status'),
  connect: clientId => invoke('pocket:connect', clientId),
  cancelLogin: () => invoke('pocket:cancel-login'),
  disconnect: () => invoke('pocket:disconnect'),
  action: (name, args = {}) => invoke('pocket:action', name, args),
  window: action => invoke('pocket:window', action),
  open: link => invoke('pocket:open', link),
  lyrics: info => invoke('pocket:lyrics', info),
  log: (level, tag, ...args) => invoke('pocket:log', level, tag, ...args),
  syncPlayback: state => invoke('pocket:playback-state', state),
  toggleReceiver: enabled => invoke('pocket:toggle-receiver', enabled),
  checkForUpdates: () => invoke('pocket:check-for-updates'),
  installUpdate: () => invoke('pocket:install-update'),
  onUpdateAvailable: callback => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('pocket:update-available', handler);
    return () => ipcRenderer.removeListener('pocket:update-available', handler);
  },
  onUpdateDownloaded: callback => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('pocket:update-downloaded', handler);
    return () => ipcRenderer.removeListener('pocket:update-downloaded', handler);
  },
  onRemoteAction: callback => {
    const handler = (_event, action, args) => callback(action, args);
    ipcRenderer.on('pocket:remote-action', handler);
    return () => ipcRenderer.removeListener('pocket:remote-action', handler);
  },
  onWindowState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pocket:window-state', handler);
    return () => ipcRenderer.removeListener('pocket:window-state', handler);
  },
  onSoloistStatus: callback => {
    const handler = (_event, connected) => callback(connected);
    ipcRenderer.on('pocket:soloist-status', handler);
    return () => ipcRenderer.removeListener('pocket:soloist-status', handler);
  },
  onRemotePlayback: callback => {
    const handler = (_event, playback) => callback(playback);
    ipcRenderer.on('pocket:remote-playback', handler);
    return () => ipcRenderer.removeListener('pocket:remote-playback', handler);
  },
  onRemoteQueue: callback => {
    const handler = (_event, queue) => callback(queue);
    ipcRenderer.on('pocket:remote-queue', handler);
    return () => ipcRenderer.removeListener('pocket:remote-queue', handler);
  },
});
