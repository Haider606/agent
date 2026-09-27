const { contextBridge, ipcRenderer } = require("electron");

// Registry to prevent duplicate ipcRenderer listeners
const listeners = new Map();

function onChannel(channel, callback) {
  if (!listeners.has(channel)) {
    listeners.set(channel, new Set());
    ipcRenderer.on(channel, (event, ...args) => {
      const cbs = listeners.get(channel);
      if (cbs) {
        cbs.forEach((cb) => {
          try {
            cb(...args);
          } catch (err) {
            console.error(`[Preload] Callback error on ${channel}:`, err);
          }
        });
      }
    });
  }
  const cbs = listeners.get(channel);
  cbs.add(callback);

  // Return unsubscribe function
  return () => {
    cbs.delete(callback);
    if (cbs.size === 0) {
      ipcRenderer.removeAllListeners(channel);
      listeners.delete(channel);
    }
  };
}

contextBridge.exposeInMainWorld("electronAPI", {
  onUpdateAvailable: (cb) => onChannel("update-available", cb),
  onUpdateDownloaded: (cb) => onChannel("update-downloaded", cb),
  onUpdateError: (cb) => onChannel("update-error", cb),
  onUpdateProgress: (cb) => onChannel("update-progress", cb),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  restartApp: () => ipcRenderer.send("restart-app"),
  installUpdate: () => ipcRenderer.send("install-update"),
  getVersion: () => ipcRenderer.invoke("get-version"),
  onCloudStatus: (cb) => onChannel("cloud-status", cb),
});