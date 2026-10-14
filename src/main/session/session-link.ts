import type { IpcMainInvokeEvent } from "electron";
import type { InteractiveLoginResult } from "../../modules/vinted/session/interactiveSessionExtractor";
import { SessionUploadService } from "../../modules/vinted/session/sessionUpload.service";
import { UnauthorizedError } from "../../services/errors";
import { redactSession } from "../api/auth.handlers";
import { tokenStore } from "../api/token-store";

/** Progress for the window, by step name (see the steps messages); `message` is for the log. */
export type ProgressSender = (step: string, message: string) => void;

export interface LinkSessionResult {
  success: boolean;
  message: string;
}

/**
 * The renderer logs the user out on an UnauthorizedError, but only one that
 * comes back through the api bridge. Linking runs here and turns every failure
 * into a plain result, so a dead session used to end on "User not
 * authenticated" with the user left on the page. Tell the renderer directly.
 */
function signalUnauthorized(sender: Electron.WebContents, error: unknown): void {
  if (!(error instanceof UnauthorizedError)) return;
  sender.send("auth:unauthorized", { message: error.message });
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Link the Vinted account with the login's cookies - the only thing that
 * leaves the machine. The API stores them as the account's session, and the
 * backend's (Chromium) browser starts from them.
 */
export async function linkSession(
  event: IpcMainInvokeEvent,
  result: InteractiveLoginResult,
  options: { userEmail?: string; vintedEmail?: string; vintedMemberId?: string },
  sendProgress: ProgressSender
): Promise<LinkSessionResult> {
  const { userEmail, vintedEmail, vintedMemberId } = options;

  // Without these there is nothing to save the session under.
  if (!userEmail || !vintedEmail) {
    const missing = [!userEmail && "your account id", !vintedEmail && "the Vinted email"].filter(Boolean).join(" and ");
    return { success: false, message: `Session NOT saved: ${missing} missing. Log in again and retry.` };
  }

  // The renderer's token can be long expired by now (see freshAccessToken).
  let accessToken: string;
  try {
    accessToken = await tokenStore.freshAccessToken(undefined, (session) =>
      event.sender.send("auth:session-refreshed", redactSession(session))
    );
  } catch (error) {
    console.error(`[Session] Could not get a valid access token: ${errorMessage(error)}`);
    signalUnauthorized(event.sender, error);
    return {
      success: false,
      message: `Your session has expired. Please log in again. Session NOT saved. (${errorMessage(error)})`,
    };
  }

  try {
    sendProgress("LINKING", `Linking Vinted account with ${result.vinted_cookies.length} cookie(s)...`);
    const linkResult = await SessionUploadService.linkVintedAccount(
      {
        url: result.url,
        cookies: result.vinted_cookies,
        storage: { localStorage: {}, sessionStorage: {} },
        extracted_at: result.extracted_at,
      },
      { userEmail, vintedEmail, vintedMemberId, accessToken }
    );

    if (!linkResult.success) {
      if (linkResult.unauthorized) signalUnauthorized(event.sender, new UnauthorizedError(linkResult.message));
      console.error(`[Session] Account linking failed: ${linkResult.message}`);
      return { success: false, message: `Account linking failed. Session NOT saved. ${linkResult.message}` };
    }
    console.log(`[Session] Account linked (ID: ${linkResult.id})`);
  } catch (error) {
    console.error(`[Session] Account linking failed:`, error);
    return { success: false, message: `Account linking failed. Session NOT saved. ${errorMessage(error)}` };
  }

  return { success: true, message: "Account linked" };
}
