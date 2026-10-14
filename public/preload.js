const { contextBridge, ipcRenderer } = require("electron");

// Only what the UI uses. Every entry here is reachable by any code running in
// the page, so nothing is exposed "in case".

contextBridge.exposeInMainWorld("electronAPI", {
  // Authenticated API calls. These run in the main process, which sends no
  // Origin header, so the API's CORS policy never applies. The renderer must
  // not fetch api.vinbot.app directly: a packaged build is a file:// page and
  // its Origin is the literal string "null", which the API rejects.
  auth: {
    login: (credentials) => ipcRenderer.invoke("api:login", credentials),
    // Google sign-in runs in the user's browser; main keeps the tokens
    providers: () => ipcRenderer.invoke("api:providers"),
    googleLogin: () => ipcRenderer.invoke("api:googleLogin"),
    cancelGoogleLogin: () => ipcRenderer.invoke("api:cancelGoogleLogin"),
    me: (accessToken) => ipcRenderer.invoke("api:me", accessToken),
    refresh: (refreshToken) => ipcRenderer.invoke("api:refresh", refreshToken),
    logout: (accessToken) => ipcRenderer.invoke("api:logout", accessToken),
    getStoredSession: () => ipcRenderer.invoke("api:getStoredSession"),
    // Main refreshed the session on its own (before an upload); the renderer
    // stores the new expiry (never the tokens). Returns unsubscribe.
    onSessionRefreshed: (callback) => {
      const listener = (event, session) => callback(session);
      ipcRenderer.on("auth:session-refreshed", listener);
      return () => ipcRenderer.removeListener("auth:session-refreshed", listener);
    },
    // An upload or link in main hit a dead session. Returns unsubscribe.
    onUnauthorized: (callback) => {
      const listener = (event, detail) => callback(detail);
      ipcRenderer.on("auth:unauthorized", listener);
      return () => ipcRenderer.removeListener("auth:unauthorized", listener);
    },
  },
  // Interactive login handler
  interactiveLogin: (options) => ipcRenderer.invoke("vinted:interactiveLogin", options),
  // Import an existing session from the user's own Firefox (same progress/error events)
  findFirefoxSessions: () => ipcRenderer.invoke("vinted:findFirefoxSessions"),
  importFirefoxSession: (options) =>
    ipcRenderer.invoke("vinted:importFirefoxSession", options),
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
