import fs from "fs";
import path from "path";
import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

/**
 * Keeps installed copies up to date, from the Releases of the public
 * jansanc/vinbot-desktop-releases repo (package.json build.publish; see
 * vault/RELEASING.md). A release only reaches users once it is published,
 * not while it is a draft.
 *
 * It checks a little after launch and every few hours, downloads a new
 * version in the background, then offers "Restart to update" in the window.
 * Ignored, the update installs the next time the app quits. Restarting is
 * refused while a session login or upload runs (markBusy), so it never cuts
 * one off.
 */

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type UpdateStatus =
  | { state: "idle" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string };

let status: UpdateStatus = { state: "idle" };
let busy = 0;

const LOG_MAX_BYTES = 512 * 1024;

/**
 * Also written to <userData>/logs/updater.log: an installed Windows app has no
 * console, and "why didn't it update" can only be answered from the user's
 * machine. Starts over past LOG_MAX_BYTES.
 */
function log(level: "info" | "warn" | "error", message: unknown): void {
  const line = `[Updater] ${message instanceof Error ? message.message : String(message)}`;
  console[level === "info" ? "log" : level](line);
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    const file = path.join(dir, "updater.log");
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) fs.rmSync(file);
    fs.appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`);
  } catch {
    // Logging must never break updating
  }
}

/** Marks a session login or upload as running; call the result when it ends. */
export function markBusy(): () => void {
  busy++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    busy--;
  };
}

function broadcast(next: UpdateStatus): void {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("updater:status", status);
  }
}

function check(): void {
  autoUpdater.checkForUpdates().catch((error) => {
    // Offline, or no release published yet: try again at the next interval
    log("warn", `Check failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/**
 * Whether this copy can update itself: an installed build. Development runs
 * have nothing to replace, and the Windows portable exe is not something the
 * updater can swap (electron-builder sets PORTABLE_EXECUTABLE_DIR in it).
 */
function canUpdate(): boolean {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

export function startUpdater(): void {
  // The window asks for the status on mount; answer even where updates are off
  ipcMain.handle("updater:getStatus", () => status);
  ipcMain.handle("updater:install", () => {
    if (status.state !== "ready") return { ok: false, reason: "not-ready" as const };
    if (busy > 0) return { ok: false, reason: "busy" as const };
    // Silent on Windows (no installer wizard), then reopen the app
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { ok: true as const };
  });

  if (!canUpdate()) {
    log("info", "Off: not an installed build");
    return;
  }

  log("info", `On: version ${app.getVersion()}`);
  autoUpdater.logger = {
    info: (message: unknown) => log("info", message),
    warn: (message: unknown) => log("warn", message),
    error: (message: unknown) => log("error", message),
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  // The NSIS installer is a full one, not a web stub
  autoUpdater.disableWebInstaller = true;
  // The fallback when "Restart to update" is ignored
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info: UpdateInfo) =>
    broadcast({ state: "downloading", version: info.version, percent: 0 })
  );
  autoUpdater.on("download-progress", (progress) => {
    if (status.state === "downloading") {
      broadcast({ ...status, percent: Math.round(progress.percent) });
    }
  });
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => broadcast({ state: "ready", version: info.version }));
  autoUpdater.on("error", (error) => {
    log("error", error);
    // A failed download starts over at the next check; a ready update stays ready
    if (status.state === "downloading") broadcast({ state: "idle" });
  });

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(() => {
    // Nothing to look for while a downloaded update waits to be installed
    if (status.state !== "ready") check();
  }, CHECK_INTERVAL_MS);
}
