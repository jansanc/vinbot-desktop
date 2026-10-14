import { registerAuthHandlers } from "./api/auth.handlers";
import { registerLoginHandlers } from "./session/login.handlers";
import { startUpdater } from "./updater";

/**
 * Register all IPC handlers for the Electron main process
 */
function registerIPCHandlers() {
  console.log("[IPC] Registering all IPC handlers...");

  // Authenticated API calls (login/me/refresh/logout/link). These run here in
  // main so requests carry no Origin header and bypass CORS entirely.
  registerAuthHandlers();

  // The Vinted login window, and saving the session it captures
  registerLoginHandlers();

  // Background updates (no-op outside an installed build)
  startUpdater();

  console.log("[IPC] All handlers registered successfully!");
}

module.exports = { registerIPCHandlers };
