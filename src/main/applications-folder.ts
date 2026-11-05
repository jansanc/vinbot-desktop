import { app, dialog } from "electron";
import { pickLocale, translate } from "../i18n/messages";

/**
 * macOS: offer to move the app into Applications when it runs from anywhere
 * else - most often straight from the mounted DMG, or from Downloads (where
 * Gatekeeper runs it from a random read-only copy). From there:
 *
 * - the bundled Firefox is on a disk image too, and Firefox has its own
 *   run-from-DMG handling (offering to install itself and relaunch), which
 *   would end the login;
 * - updates can't be installed, as the app can't replace itself.
 *
 * Resolves true when the app is being moved: it relaunches from
 * Applications, so this copy should open no window.
 */
export async function offerMoveToApplications(): Promise<boolean> {
  if (process.platform !== "darwin" || !app.isPackaged || app.isInApplicationsFolder()) return false;

  // The window's language choice isn't readable yet; the system's is close
  const locale = pickLocale(app.getPreferredSystemLanguages());
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: [translate(locale, "moveToApplications.move"), translate(locale, "moveToApplications.notNow")],
    defaultId: 0,
    cancelId: 1,
    message: translate(locale, "moveToApplications.title"),
    detail: translate(locale, "moveToApplications.body"),
  });
  if (response !== 0) return false;

  try {
    // An older copy already in Applications is replaced. One that is running
    // can't be: the single-instance lock would have stopped this copy starting.
    return app.moveToApplicationsFolder({ conflictHandler: () => true });
  } catch (error) {
    console.error(`[Electron] Could not move the app to Applications: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}
