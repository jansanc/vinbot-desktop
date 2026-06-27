let electron;
try {
  electron = require("electron");
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

let mainWindow;

const createWindow = () => {
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
    }
  } catch (error) {
    console.warn("[IPC] Warning - handlers not loaded:", error.message);
  }
};

app.on("ready", () => {
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
      ...(isDev ? [{ role: "toggleDevTools" }] : []),
    ],
  },
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);


