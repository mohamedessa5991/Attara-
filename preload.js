const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localData', {
  load: () => ipcRenderer.sendSync('data-load'),
  save: (data) => ipcRenderer.sendSync('data-save', data),
  backupSave: (json, name) => ipcRenderer.invoke('backup-save', json, name),
  backupOpen: () => ipcRenderer.invoke('backup-open'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  dataPath: () => ipcRenderer.invoke('app-data-path')
});
