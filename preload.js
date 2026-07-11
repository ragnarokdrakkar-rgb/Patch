const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopStorage', {
  load: () => ipcRenderer.sendSync('storage:load-sync'),
  save: (data) => ipcRenderer.sendSync('storage:save-sync', data),
  clear: () => ipcRenderer.sendSync('storage:clear-sync'),
  getPath: () => ipcRenderer.sendSync('storage:path-sync'),
  getAppVersion: () => ipcRenderer.sendSync('app:version-sync'),
  loadDeviceSettings: () => ipcRenderer.sendSync('device-settings:load-sync'),
  saveDeviceSettings: (value) => ipcRenderer.sendSync('device-settings:save-sync', value),
  openFolder: () => ipcRenderer.invoke('storage:open-folder'),
});
