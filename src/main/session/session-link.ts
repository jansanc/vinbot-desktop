import type { IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import type { InteractiveLoginResult } from "../../modules/vinted/session/interactiveSessionExtractor";
import { SessionUploadService } from "../../modules/vinted/session/sessionUpload.service";
import { ApiService } from "../../services/api.service";
import { UnauthorizedError } from "../../services/errors";
import { redactSession } from "../api/auth.handlers";
import { tokenStore } from "../api/token-store";

/** Progress for the window, by step name (see the steps messages); `message` is for the log. */
export type ProgressSender = (step: string, message: string) => void;

export interface LinkSessionResult {
  success: boolean;
  session?: InteractiveLoginResult;
  message: string;
}

/**
 * The renderer logs the user out on an UnauthorizedError, but only one that
 * comes back through the api bridge. Uploads and links run here and turn every
 * failure into a plain result, so a dead session used to end on "User not
 * authenticated" with the user left on the page. Tell the renderer directly.
 */
function signalUnauthorized(sender: Electron.WebContents, error: unknown): void {
  if (!(error instanceof UnauthorizedError)) return;
  sender.send("auth:unauthorized", { message: error.message });
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Upload a captured session's profile archive to S3, then link the Vinted
 * account with its cookies. The account is only linked once the upload has
 * succeeded, and any failure ends the flow with nothing saved.
 */
export async function uploadAndLinkSession(
  event: IpcMainInvokeEvent,
  result: InteractiveLoginResult,
  options: {
    profileName: string;
    userEmail?: string;
    vintedEmail?: string;
    vintedMemberId?: string;
    /** Optional: freshAccessToken falls back to the session main holds. */
    accessToken?: string;
    /** Stored with the uploaded profile; `type` says where the session came from. */
    metadata: Record<string, unknown>;
  },
  sendProgress: ProgressSender
): Promise<LinkSessionResult> {
  const { profileName, userEmail, vintedEmail, vintedMemberId, metadata } = options;

  // Without these there is nothing to save the session under.
  if (!userEmail || !vintedEmail) {
    const missing = [!userEmail && "your account id", !vintedEmail && "the Vinted email"].filter(Boolean).join(" and ");
    return { success: false, session: result, message: `Session NOT saved: ${missing} missing. Log in again and retry.` };
  }

  // The renderer's token can be long expired by now (see freshAccessToken).
  let accessToken: string;
  try {
    accessToken = await tokenStore.freshAccessToken(options.accessToken, (session) =>
      event.sender.send("auth:session-refreshed", redactSession(session))
    );
  } catch (error) {
    console.error(`[Session] Could not get a valid access token: ${errorMessage(error)}`);
    signalUnauthorized(event.sender, error);
    return {
      success: false,
      session: result,
      message: `Your session has expired. Please log in again. Session NOT saved. (${errorMessage(error)})`,
    };
  }

  // Step 1: upload the profile archive. The API derives the storage key from
  // the user id and the Vinted email.
  let storagePath: string;
  try {
    sendProgress("UPLOADING", `Uploading profile archive (${result.profile_archive_size} bytes)...`);
    const uploaded = await ApiService.uploadBrowserProfile(accessToken, {
      browser: "firefox",
      profileId: profileName,
      profileName,
      vintedAccountId: vintedMemberId || profileName,
      profileData: fs.readFileSync(result.profile_archive_path),
      compressedSize: result.profile_archive_size,
      originalSize: result.profile_archive_size,
      metadata: JSON.stringify({
        compressedAt: new Date(result.compressed_at).toISOString(),
        extractedAt: new Date(result.extracted_at).toISOString(),
        ...metadata,
      }),
      vintedEmail,
      vintedMemberId: vintedMemberId || undefined,
    });
    storagePath = uploaded.storagePath;
    console.log(`[Session] Profile uploaded (ID: ${uploaded.id}) -> ${storagePath}`);
  } catch (error) {
    console.error(`[Session] Profile upload failed:`, error);
    signalUnauthorized(event.sender, error);
    return { success: false, session: result, message: `Profile upload failed. Session NOT saved. ${errorMessage(error)}` };
  }

  // Step 2: link the account. The real Vinted cookies from the login profile
  // are what the backend's (Chromium) browser engine bootstraps from - it
  // cannot open the Firefox profile archive itself.
  try {
    sendProgress("LINKING", `Linking Vinted account with ${result.vinted_cookies.length} cookie(s)...`);
    const linkResult = await SessionUploadService.linkVintedAccount(
      {
        profile_name: result.profile_name,
        profile_path: result.profile_path,
        url: result.url,
        cookies: result.vinted_cookies,
        storage: { localStorage: {}, sessionStorage: {} },
        extracted_at: result.extracted_at,
      },
      { userEmail, vintedEmail, vintedMemberId, accessToken, profileS3: storagePath }
    );

    if (!linkResult.success) {
      if (linkResult.unauthorized) signalUnauthorized(event.sender, new UnauthorizedError(linkResult.message));
      console.error(`[Session] Account linking failed: ${linkResult.message}`);
      return { success: false, session: result, message: `Account linking failed. Session NOT saved. ${linkResult.message}` };
    }
    console.log(`[Session] Account linked (ID: ${linkResult.id})`);
  } catch (error) {
    console.error(`[Session] Account linking failed:`, error);
    return { success: false, session: result, message: `Account linking failed. Session NOT saved. ${errorMessage(error)}` };
  }

  return { success: true, session: result, message: "Profile uploaded and account linked" };
}
