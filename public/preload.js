const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  extractVintedSession: (options) =>
    ipcRenderer.invoke("extract:vinted:session", options),
  saveExtraction: (data, saveMethod, options) =>
    ipcRenderer.invoke("save:extraction", data, saveMethod, options),
  selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory"),
  onExtractionProgress: (callback) =>
    ipcRenderer.on("extraction:progress", (event, data) => callback(data)),
  removeProgressListener: () =>
    ipcRenderer.removeAllListeners("extraction:progress"),
  getFirefoxProfiles: () => ipcRenderer.invoke("firefox:getProfiles"),
  getChromeProfiles: () => ipcRenderer.invoke("chrome:getProfiles"),
  getEdgeProfiles: () => ipcRenderer.invoke("edge:getProfiles"),
  validateVintedCredentials: (email, memberId) =>
    ipcRenderer.invoke("vinted:validate", email, memberId),
  openExternalLink: (url) => ipcRenderer.invoke("open:external", url),
});
