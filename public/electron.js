console.log("[Electron] Starting...");

let electron;
try {
  electron = require("electron");
  console.log("[Electron] Module loaded");
  console.log("[Electron] Available exports:", Object.keys(electron).slice(0, 10));
} catch (err) {
  console.error("[Electron] Failed to load module:", err.message);
  process.exit(1);
}

const { app, BrowserWindow, Menu } = electron;

if (!app) {
  console.error("[Electron] app is undefined!");
  console.error("[Electron] electron object:", electron);
  process.exit(1);
}

const path = require("path");
const isDev = process.env.ELECTRON_DEV === "true";

console.log("[Electron] Configuration - isDev:", isDev, "ELECTRON_DEV:", process.env.ELECTRON_DEV);

let mainWindow;

const createWindow = () => {
  console.log("[Electron] Creating window...");
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const startUrl = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "../build/index.html")}`;

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
    const ipcHandlers = require("../dist/main/ipc-handlers.js");
    if (typeof ipcHandlers.registerIPCHandlers === "function") {
      ipcHandlers.registerIPCHandlers();
      console.log("[IPC] Handlers registered successfully");
    } else {
      throw new Error("registerIPCHandlers is not a function in ipc-handlers module");
    }
  } catch (error) {
    console.error("[IPC] Failed to register handlers:", error.message);
    const { dialog: errorDialog } = require("electron");
    errorDialog.showErrorBox(
      "Initialization Error",
      `Failed to load IPC handlers: ${error.message}\n\nThe application may not function correctly.`
    );
  }
};

console.log("[Electron] Waiting for app ready...");

app.on("ready", () => {
  console.log("[Electron] App ready!");
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

const template = [
  {
    label: "File",
    submenu: [
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
    ],
  },
  {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
    ],
  },
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

console.log("[Electron] Initialization complete, waiting for app events...");
