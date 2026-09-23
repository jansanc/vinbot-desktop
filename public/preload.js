const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Authenticated API calls. These run in the main process, which sends no
  // Origin header, so the API's CORS policy never applies. The renderer must
  // not fetch api.vinbot.app directly: a packaged build is a file:// page and
  // its Origin is the literal string "null", which the API rejects.
  auth: {
    login: (credentials) => ipcRenderer.invoke("api:login", credentials),
    me: (accessToken) => ipcRenderer.invoke("api:me", accessToken),
    refresh: (refreshToken) => ipcRenderer.invoke("api:refresh", refreshToken),
    logout: (accessToken) => ipcRenderer.invoke("api:logout", accessToken),
    storeDesktopSession: (payload) =>
      ipcRenderer.invoke("api:storeDesktopSession", payload),
    getStoredSession: () => ipcRenderer.invoke("api:getStoredSession"),
  },
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
  openBrowserWithProfile: (browser, profile) =>
    ipcRenderer.invoke("browser:open", browser, profile),
  // Profile upload handlers
  uploadProfile: (options) =>
    ipcRenderer.invoke("vinted:uploadProfile", options),
  batchUploadProfiles: (options) =>
    ipcRenderer.invoke("vinted:batchUploadProfiles", options),
  onBatchUploadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on("batch-upload-progress", listener);
    return () => ipcRenderer.removeListener("batch-upload-progress", listener);
  },
  // Session extraction handlers
  extractSession: (options) => ipcRenderer.invoke("vinted:extractSession", options),
  extractAndUploadSession: (options) =>
    ipcRenderer.invoke("vinted:extractAndUploadSession", options),
  downloadProfile: (options) => ipcRenderer.invoke("vinted:downloadProfile", options),
  // Interactive login handler
  interactiveLogin: (options) => ipcRenderer.invoke("vinted:interactiveLogin", options),
  // Import an existing session from the user's own Firefox (same progress/error events)
  findFirefoxSessions: () => ipcRenderer.invoke("vinted:findFirefoxSessions"),
  importFirefoxSession: (options) =>
    ipcRenderer.invoke("vinted:importFirefoxSession", options),
  // Event listeners
  on: (channel, callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return listener; // Return listener reference for cleanup
  },
  off: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },
  // Convenience methods for specific events
  onInteractiveLoginProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on("interactive-login-progress", listener);
    return listener;
  },
  offInteractiveLoginProgress: (listener) => {
    ipcRenderer.removeListener("interactive-login-progress", listener);
  },
  onInteractiveLoginError: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on("interactive-login-error", listener);
    return listener;
  },
  offInteractiveLoginError: (listener) => {
    ipcRenderer.removeListener("interactive-login-error", listener);
  },
});
