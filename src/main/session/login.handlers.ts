import { ipcMain } from "electron";
import * as fs from "fs";
import { config } from "../../config/config";
import {
  InteractiveSessionExtractor,
  LoginFlowError,
  type LoginStatus,
} from "../../modules/vinted/session/interactiveSessionExtractor";
import { tokenStore } from "../api/token-store";
import { markBusy } from "../updater";
import { uploadAndLinkSession, type LinkSessionResult, type ProgressSender } from "./session-link";

/** The login in progress, if any: there is one Firefox login window at a time. */
let activeLogin: InteractiveSessionExtractor | null = null;

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
  // Open Firefox for the user to log in to Vinted, then upload the session and
  // link the account. Progress goes to the window on interactive-login-progress.
  ipcMain.handle(
    "vinted:interactiveLogin",
    async (event, options: { userEmail?: string; vintedEmail?: string; vintedMemberId?: string }) => {
      if (activeLogin) {
        return { success: false, code: "LOGIN_IN_PROGRESS", message: "A login is already in progress." } as LoginResponse;
      }
      // There must be a session to upload with
      if (!tokenStore.get()?.accessToken) {
        return { success: false, code: "SESSION_EXPIRED", message: "Session expired. Please log in again." } as LoginResponse;
      }

      const sendProgress: ProgressSender = (step, message) => {
        console.log(`[Login] ${step}: ${message}`);
        event.sender.send("interactive-login-progress", { step, message, timestamp: new Date().toISOString() });
      };

      const extractor = new InteractiveSessionExtractor();
      activeLogin = extractor;
      // "Restart to update" waits until this is done
      const releaseBusy = markBusy();
      // The archive only exists to be uploaded; remove it however the flow ends
      // so each login doesn't leave ~20 MB behind in %TEMP%.
      let archivePath: string | undefined;

      try {
        const url = loginUrl();
        const profileName = `vinted_${Date.now()}`;
        sendProgress("OPENING_FIREFOX", `Opening Firefox at ${url}`);

        const result = await extractor.interactiveLogin({
          url,
          profileName,
          timeout: config.vinted.loginTimeoutSeconds,
          onStatus: (status) => sendProgress(STATUS_STEPS[status], status),
        });
        archivePath = result.profile_archive_path;
        console.log(
          `[Login] Profile archived: ${(result.profile_archive_size / (1024 * 1024)).toFixed(2)}MB after ` +
            `${(result.loginDuration / 1000).toFixed(1)}s; Vinted login state: ${result.vinted_login}`
        );

        return (await uploadAndLinkSession(
          event,
          result,
          {
            profileName,
            userEmail: options.userEmail,
            vintedEmail: options.vintedEmail,
            vintedMemberId: options.vintedMemberId,
            metadata: { loginUrl: url, type: "interactive-login" },
          },
          sendProgress
        )) as LoginResponse;
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
        releaseBusy();
        if (archivePath) {
          try {
            fs.rmSync(archivePath, { force: true });
          } catch (e) {
            console.warn(`[Login] Could not delete profile archive ${archivePath}: ${e}`);
          }
        }
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
