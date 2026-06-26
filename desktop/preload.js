const { contextBridge, ipcRenderer } = require('electron');

// Bridge mDNS discovery from the main process into the renderer. The discovery
// module (client/src/discovery.js) checks for window.chessDiscovery and uses it
// when present; otherwise it falls back to IP scanning.
contextBridge.exposeInMainWorld('chessDiscovery', {
  start(onHost, onLost) {
    const cbId = Math.random().toString(36).slice(2);
    this._cbId = cbId;
    ipcRenderer.on(`discovery:host:${cbId}`, (_event, host) => onHost(host));
    ipcRenderer.invoke('discovery:start');
    ipcRenderer.send('discovery:onHost', cbId);
    this._onLost = onLost || null;
  },
  stop() {
    if (this._cbId) {
      ipcRenderer.removeAllListeners(`discovery:host:${this._cbId}`);
      this._cbId = null;
    }
    ipcRenderer.invoke('discovery:stop');
  },
});
