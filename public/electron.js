console.log("[Electron] Starting...");

let app, BrowserWindow, Menu, session;
try {
  const electron = require("electron");
  app = electron.app;
  BrowserWindow = electron.BrowserWindow;
  Menu = electron.Menu;
  session = electron.session;
  console.log("[Electron] Module loaded successfully");
  if (!app) {
    throw new Error("Failed to get app from electron module");
  }
} catch (err) {
  console.error("[Electron] Failed to load module:", err.message);
  process.exit(1);
}

const path = require("path");
const { pathToFileURL } = require("url");
// Never dev in an installed build: dev mode loads localhost and opens dev tools
// with the full electronAPI, so an env var must not be able to switch it on.
const isDev = !app.isPackaged && process.env.ELECTRON_DEV === "true";

const DEV_URL = "http://localhost:3002/";
const startUrl = isDev
  ? DEV_URL
  : pathToFileURL(path.join(__dirname, "../build/index.html")).href;

/**
 * The window only ever shows the app itself. The preload hands every page it
 * runs in the full electronAPI - reading browser profiles, uploading them - so
 * a link or redirect to any other page must never load in it.
 */
const isAppUrl = (url) => {
  if (isDev) return url.startsWith(DEV_URL);
  return url.split(/[?#]/)[0] === startUrl;
};

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      console.warn("[Electron] Blocked navigation to", url);
      event.preventDefault();
    }
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // target="_blank" links open in the user's browser, never in a new app
  // window (which would get the preload too). Only https: see open:external.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      require("electron").shell.openExternal(url);
    }
    return { action: "deny" };
  });
});

console.log("[Electron] Configuration - isDev:", isDev, "ELECTRON_DEV:", process.env.ELECTRON_DEV);

let mainWindow;

const createWindow = () => {
  console.log("[Electron] Creating window...");
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, "favicon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  console.log("[Electron] Loading URL:", startUrl);
  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

const registerIPC = () => {
  try {
    console.log("[IPC] Loading ipc-handlers from:", require.resolve("../dist/main/ipc-handlers.js"));
    const ipcHandlers = require("../dist/main/ipc-handlers.js");
    console.log("[IPC] Loaded ipcHandlers:", Object.keys(ipcHandlers));
    if (typeof ipcHandlers.registerIPCHandlers === "function") {
      console.log("[IPC] Calling registerIPCHandlers function...");
      ipcHandlers.registerIPCHandlers();
      console.log("[IPC] Handlers registered successfully");
    } else {
      console.error("[IPC] registerIPCHandlers is not a function. Type:", typeof ipcHandlers.registerIPCHandlers);
    }
  } catch (error) {
    console.error("[IPC] ERROR - handlers not loaded:", error);
    console.error("[IPC] Stack:", error.stack);
  }
};

// One instance only: a second one would share the token store and the Firefox
// login profile with the first. Launching again focuses the open window.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

console.log("[Electron] Waiting for app ready...");

app.on("ready", () => {
  if (!isPrimaryInstance) return;
  console.log("[Electron] App ready!");
  // The app needs no camera, notifications, geolocation, ...
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIPC();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

const isMac = process.platform === "darwin";

const template = [
  // macOS puts the app menu (About, Hide, Quit ⌘Q) first.
  ...(isMac ? [{ role: "appMenu" }] : []),
  {
    label: "File",
    submenu: isMac
      ? [{ role: "close" }]
      : [
          {
            label: "Exit",
            accelerator: "CmdOrCtrl+Q",
            click: () => {
              app.quit();
            },
          },
        ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "View",
    // Dev tools give a console with the full electronAPI; dev builds only.
    submenu: isDev
      ? [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }]
      : [{ role: "reload" }],
  },
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

console.log("[Electron] Initialization complete, waiting for app events...");
