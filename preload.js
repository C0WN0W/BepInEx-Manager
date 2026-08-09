const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scanGames:        () => ipcRenderer.invoke('scan-games'),
  addCustomGame:    () => ipcRenderer.invoke('add-custom-game'),
  removeCustomGame: (id) => ipcRenderer.invoke('remove-custom-game', id),
  inspectGame:      (p) => ipcRenderer.invoke('inspect-game', p),
  fetchReleases:    () => ipcRenderer.invoke('fetch-releases'),
  installBepInEx:   (args) => ipcRenderer.invoke('install-bepinex', args),
  uninstallBepInEx: (p)   => ipcRenderer.invoke('uninstall-bepinex', p),
  scanPlugins:      (p)   => ipcRenderer.invoke('scan-plugins', p),
  togglePlugin:     (p)   => ipcRenderer.invoke('toggle-plugin', p),
  deletePlugin:     (p)   => ipcRenderer.invoke('delete-plugin', p),
  importPlugin:     (gp)  => ipcRenderer.invoke('import-plugin', gp),
  onInstallProgress: (handler) => {
    const wrapped = (_e, msg) => handler(msg);
    ipcRenderer.on('install-progress', wrapped);
    return () => ipcRenderer.removeListener('install-progress', wrapped);
  },
});
