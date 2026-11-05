import { ipcMain } from "electron";
import { config } from "../../config/config";
import {
  InteractiveSessionExtractor,
  LoginFlowError,
  type LoginStatus,
} from "../../modules/vinted/session/interactiveSessionExtractor";
import { tokenStore } from "../api/token-store";
import { markBusy } from "../updater";
import { linkSession, type LinkSessionResult, type ProgressSender } from "./session-link";
import { isLocale } from "../../i18n/messages";

/** The login in progress, if any: there is one Firefox login window at a time. */
let activeLogin: InteractiveSessionExtractor | null = null;
/** Settles once the login in progress has ended and cleaned up after itself. */
let activeLoginDone: Promise<void> | null = null;

/** The longest quitting the app waits for a login to wind down (see endActiveLogin). */
const END_LOGIN_WAIT_MS = 20000;

/**
 * For the app quitting: close the login's Firefox without saving, and resolve
 * once the login has cleaned up (its temp profile, holding the user's Vinted
 * cookies, deleted), or after END_LOGIN_WAIT_MS at the latest. Null when no
 * login is running. Without this, quitting mid-login left Firefox open on its
 * own (it is started detached) and the temp profile on disk.
 */
export function endActiveLogin(): Promise<void> | null {
  if (!activeLogin || !activeLoginDone) return null;
  activeLogin.cancel();
  return Promise.race([activeLoginDone, new Promise<void>((resolve) => setTimeout(resolve, END_LOGIN_WAIT_MS))]);
}

/**
 * The page Firefox opens for the login. Only https Vinted pages: the URL is a
 * Firefox command-line argument, where a value starting with "-" is read as an
 * option, and any other site has no business in this flow.
 */
function loginUrl(): string {
  const url = new URL(config.vinted.loginPath, config.vinted.baseUrl);
  if (url.protocol !== "https:" || !/(^|\.)vinted\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(url.hostname)) {
    throw new Error(`The login URL must be an https Vinted page (got: ${url.origin})`);
  }
  return url.toString();
}

/** The progress step the window shows for each stage of the login itself. */
const STATUS_STEPS: Record<LoginStatus, string> = {
  "waiting-for-login": "WAITING_FOR_LOGIN",
  "logged-in": "LOGGED_IN",
  saving: "SAVING",
};

/** What the window gets back from vinted:interactiveLogin. */
type LoginResponse = LinkSessionResult & {
  /** Set when the window has its own text for why the login ended (see LoginFlowError). */
  code?: LoginFlowError["code"] | "SESSION_EXPIRED" | "LOGIN_IN_PROGRESS";
};

export function registerLoginHandlers(): void {
  // Open Firefox for the user to log in to Vinted, then link the account with
  // the login's cookies. Progress goes to the window on interactive-login-progress.
  ipcMain.handle(
    "vinted:interactiveLogin",
    async (
      event,
      options: { userEmail?: string; vintedEmail?: string; vintedMemberId?: string; locale?: string }
    ) => {
      if (activeLogin) {
        return { success: false, code: "LOGIN_IN_PROGRESS", message: "A login is already in progress." } as LoginResponse;
      }
      // There must be a Vinbot session to link with
      if (!tokenStore.get()?.accessToken) {
        return { success: false, code: "SESSION_EXPIRED", message: "Session expired. Please log in again." } as LoginResponse;
      }

      const sendProgress: ProgressSender = (step, message) => {
        console.log(`[Login] ${step}: ${message}`);
        // On macOS the app keeps running with its window closed, and the login
        // with it. Sending to the closed window throws, which used to stop
        // Firefox closing itself and the session being saved.
        if (event.sender.isDestroyed()) return;
        event.sender.send("interactive-login-progress", { step, message, timestamp: new Date().toISOString() });
      };

      const extractor = new InteractiveSessionExtractor();
      activeLogin = extractor;
      let loginEnded!: () => void;
      activeLoginDone = new Promise<void>((resolve) => (loginEnded = resolve));
      // "Restart to update" waits until this is done
      const releaseBusy = markBusy();

      try {
        const url = loginUrl();
        sendProgress("OPENING_FIREFOX", `Opening Firefox at ${url}`);

        const result = await extractor.interactiveLogin({
          url,
          timeout: config.vinted.loginTimeoutSeconds,
          locale: isLocale(options.locale) ? options.locale : undefined,
          onStatus: (status) => sendProgress(STATUS_STEPS[status], status),
        });
        console.log(
          `[Login] ${result.vinted_cookies.length} Vinted cookie(s) after ${(result.loginDuration / 1000).toFixed(1)}s; ` +
            `login state: ${result.vinted_login}`
        );

        return await linkSession(
          event,
          result,
          {
            userEmail: options.userEmail,
            vintedEmail: options.vintedEmail,
            vintedMemberId: options.vintedMemberId,
          },
          sendProgress
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Login] Interactive login failed: ${message}`);
        return {
          success: false,
          message,
          code: error instanceof LoginFlowError ? error.code : undefined,
        } as LoginResponse;
      } finally {
        activeLogin = null;
        activeLoginDone = null;
        releaseBusy();
        loginEnded();
      }
    }
  );

  // Close the login window without saving; vinted:interactiveLogin then
  // resolves with LOGIN_CANCELLED.
  ipcMain.handle("vinted:cancelInteractiveLogin", () => {
    activeLogin?.cancel();
    return { ok: true };
  });
}
