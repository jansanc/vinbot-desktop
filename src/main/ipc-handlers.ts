import { ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "path";
import * as fs from "fs";
import {
  InteractiveSessionExtractor,
  type InteractiveLoginResult,
} from "../modules/vinted/session/interactiveSessionExtractor";
import {
  findFirefoxVintedSessions,
  importFirefoxSession,
  vintedSiteOf,
} from "../modules/vinted/session/firefoxSessionImporter";
import { SessionUploadService } from "../modules/vinted/session/sessionUpload.service";
import { registerAuthHandlers, redactSession } from "./api/auth.handlers";
import { markBusy, startUpdater } from "./updater";
import { tokenStore } from "./api/token-store";
import { UnauthorizedError } from "../services/errors";

/**
 * The page Firefox opens for an interactive login. Only https Vinted pages: the
 * URL is a Firefox command-line argument, where a value starting with "-" is
 * read as an option, and any other site has no business in this flow.
 */
function assertVintedUrl(url: unknown): string {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`Invalid login URL: ${String(url)}`);
  }
  if (parsed.protocol !== "https:" || !/(^|\.)vinted\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(parsed.hostname)) {
    throw new Error(`The login URL must be an https Vinted page (got: ${parsed.origin})`);
  }
  return parsed.toString();
}

/** A token was passed, or main holds a session it can take one from. */
function hasAccessToken(provided?: string): boolean {
  return Boolean(provided?.trim() || tokenStore.get()?.accessToken);
}

type ProgressSender = (step: string, message: string) => void;

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

/**
 * Upload a captured session's profile archive to S3, then link the Vinted
 * account with its cookies. Shared by every way of getting a session: the
 * interactive login and the import from the user's own Firefox. Progress and
 * errors go to the renderer on the interactive-login-* channels either way.
 */
async function uploadAndLinkSession(
  event: IpcMainInvokeEvent,
  result: InteractiveLoginResult,
  options: {
    profileName: string;
    userEmail?: string;
    vintedEmail?: string;
    vintedMemberId?: string;
    /** Optional: freshAccessToken falls back to the session main holds. */
    accessToken?: string;
    uploadToS3: boolean;
    /** Stored with the uploaded profile; `type` says where the session came from. */
    metadata: Record<string, unknown>;
  },
  sendProgress: ProgressSender
) {
  const { profileName, userEmail, vintedEmail, vintedMemberId, uploadToS3, metadata } = options;

  // Without these both the upload and the link below are skipped, and the flow
  // used to end reporting success with nothing saved.
  if (!userEmail || !vintedEmail) {
    const missing = [!userEmail && "your account id", !vintedEmail && "the Vinted email"].filter(Boolean).join(" and ");
    return {
      success: false,
      session: result,
      profileUpload: null,
      healthCheck: null,
      accountLink: null,
      message: `Session NOT saved: ${missing} missing. Log in again and retry.`,
    };
  }

  // The renderer's token can be long expired by now (see freshAccessToken).
  let accessToken: string;
  try {
    accessToken = await tokenStore.freshAccessToken(options.accessToken, (session) =>
      event.sender.send("auth:session-refreshed", redactSession(session))
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[IPC] Could not get a valid access token: ${errorMsg}`);
    signalUnauthorized(event.sender, error);
    return {
      success: false,
      session: result,
      profileUpload: null,
      healthCheck: null,
      accountLink: null,
      message: `Your session has expired. Please log in again. Session NOT saved. (${errorMsg})`,
    };
  }

  const tokenValid = accessToken && accessToken.trim().length > 0;
  const hasValidToken = accessToken && accessToken.trim().length > 0;

  // Step 1: Pre-flight validation - check health and prepare linking BEFORE uploading to S3
  // This ensures we only upload the profile if the rest of the flow will succeed
  let healthCheckResult: any = null;

  // COMMENTED OUT: Session health check disabled
  /*
  if (uploadToS3 && userEmail && vintedEmail && hasValidToken) {
    try {
      sendProgress("VALIDATION_START", `🔍 Validating session before upload...`);

      // Create placeholder session for health check
      const placeholderCookie = {
        name: "vinted_login_timestamp",
        value: new Date().toISOString(),
        domain: ".vinted.com",
        path: "/",
        secure: true,
      };

      const healthCheckSession = {
        profile_name: result.profile_name,
        profile_path: result.profile_path,
        url: result.url,
        cookies: [placeholderCookie],
        storage: {
          localStorage: {},
          sessionStorage: {},
        },
        extracted_at: Date.now(),
      };

      const health = await SessionUploadService.checkSessionHealth(healthCheckSession, {
        userEmail: userEmail || "",
        vintedEmail,
        vintedMemberId,
        accessToken,
      });

      if (health.success && health.healthy && health.profileValid) {
        sendProgress("VALIDATION_COMPLETE", `✅ Session validation passed`);
        healthCheckResult = {
          success: true,
          message: "Session is healthy",
          profile: health.profile,
        };
      } else {
        sendProgress("VALIDATION_FAILED", `⚠️ Session validation failed: ${health.message}`);
        console.warn(`[IPC] Pre-flight health check failed - will NOT upload profile`);
        healthCheckResult = {
          success: false,
          healthy: health.healthy,
          profileValid: health.profileValid,
          message: health.message,
        };

        // Stop here - don't upload profile if validation fails
        return {
          success: false,
          session: result,
          profileUpload: null,
          healthCheck: healthCheckResult,
          accountLink: null,
          message: `Session validation failed before upload. Profile NOT uploaded. ${health.message}`,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Pre-flight validation error - will NOT upload profile:`, error);

      sendProgress("VALIDATION_ERROR", `⚠️ Validation error: ${errorMsg}`);

      event.sender.send("interactive-login-error", {
        error: `Session validation failed: ${errorMsg}`,
        timestamp: new Date().toISOString(),
        step: "VALIDATION",
      });

      // Stop here - error occurred before upload, so no profile to clean up
      return {
        success: false,
        session: result,
        profileUpload: null,
        healthCheck: {
          success: false,
          message: errorMsg,
        },
        accountLink: null,
        message: `Session validation error. Profile NOT uploaded. ${errorMsg}`,
      };
    }
  } else if (uploadToS3 && (!userEmail || !vintedEmail || !hasValidToken)) {
    console.log(`[IPC] Profile upload skipped - missing requirements: userEmail=${!!userEmail}, vintedEmail=${!!vintedEmail}, accessToken=${!!accessToken}`);
    sendProgress("PROFILE_UPLOAD_SKIPPED", `⏭️ Profile upload skipped (missing configuration)`);
  }
  */

  // Step 2: Upload profile to S3 (only if validation passed)
  let profileUploadResult: any = null;
  console.log(`[IPC] Upload check: uploadToS3=${uploadToS3}, userEmail=${userEmail}, vintedEmail=${vintedEmail}, accessToken=${tokenValid ? 'present' : 'missing'}`);

  if (uploadToS3 && userEmail && vintedEmail && tokenValid) {
    try {
      sendProgress("PROFILE_UPLOAD_START", `📤 Uploading profile archive to S3...`);
      console.log(`[IPC] Profile archive path: ${result.profile_archive_path}`);

      const archiveBuffer = fs.readFileSync(result.profile_archive_path);

      // One uploader for the whole app: ApiService.uploadBrowserProfile.
      // This used to issue its own http.request against config.api.baseUrl,
      // which is https in production - http.request would have gone to
      // port 80. It also computed its own "profiles/..." storage key, which
      // the API ignored. The API derives the key from userId + vintedEmail.
      const { ApiService } = await import("../services/api.service");

      sendProgress(
        "PROFILE_UPLOAD_START",
        `Uploading profile (${archiveBuffer.length} bytes)...`
      );

      const uploaded = await ApiService.uploadBrowserProfile(accessToken, {
        browser: "firefox",
        profileId: profileName,
        profileName,
        vintedAccountId: vintedMemberId || profileName,
        profileData: archiveBuffer,
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

      sendProgress(
        "PROFILE_UPLOAD_DONE",
        `Profile uploaded (ID: ${uploaded.id}) -> ${uploaded.storagePath}`
      );
      profileUploadResult = {
        success: true,
        profileId: uploaded.id,
        storageLocation: uploaded.storagePath,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Profile upload error caught:`, error);
      signalUnauthorized(event.sender, error);

      // Send both warning progress and error event for better visibility
      sendProgress("PROFILE_UPLOAD_WARNING", `⚠️ Profile upload note: ${errorMsg}`);

      // Also send an explicit error event so UI can display it prominently
      event.sender.send("interactive-login-error", {
        error: `Profile upload failed: ${errorMsg}`,
        timestamp: new Date().toISOString(),
        step: "PROFILE_UPLOAD",
      });

      profileUploadResult = {
        success: false,
        message: errorMsg,
      };
    }
  }

  // If profile upload was requested but failed, stop immediately - DO NOT save session
  if (uploadToS3 && profileUploadResult && !profileUploadResult.success) {
    console.error(`[IPC] Stopping flow - profile upload error. Session will NOT be saved.`);
    const errorMsg = profileUploadResult.message || "Profile upload failed";

    return {
      success: false,
      session: result,
      profileUpload: profileUploadResult,
      healthCheck: healthCheckResult,
      accountLink: null,
      message: `Profile upload failed. Session NOT saved. ${errorMsg}`,
    };
  }

  // Step 3: Check session health (if not already done in pre-flight validation)
  // Skip if S3 upload was disabled and we're not doing pre-flight validation
  // COMMENTED OUT: Session health check disabled
  /*
  if (!uploadToS3 && userEmail && vintedEmail && hasValidToken && !healthCheckResult) {
    try {
      sendProgress("HEALTH_CHECK_START", `🏥 Checking session health and profile validity...`);

      const placeholderCookie = {
        name: "vinted_login_timestamp",
        value: new Date().toISOString(),
        domain: ".vinted.com",
        path: "/",
        secure: true,
      };

      const healthCheckSession = {
        profile_name: result.profile_name,
        profile_path: result.profile_path,
        url: result.url,
        cookies: [placeholderCookie],
        storage: {
          localStorage: {},
          sessionStorage: {},
        },
        extracted_at: Date.now(),
      };

      const health = await SessionUploadService.checkSessionHealth(healthCheckSession, {
        userEmail: userEmail || "",
        vintedEmail,
        vintedMemberId,
        accessToken,
        profileLocation: profileUploadResult?.storageLocation,
      });

      if (health.success && health.healthy && health.profileValid) {
        sendProgress("HEALTH_CHECK_COMPLETE", `✅ Session is healthy and profile is valid`);
        if (health.profile?.email) {
          sendProgress("PROFILE_INFO", `👤 Profile email: ${health.profile.email.substring(0, 5)}...`);
        }
        if (health.profile?.memberId) {
          sendProgress("MEMBER_ID", `🆔 Member ID: ${health.profile.memberId}`);
        }
        healthCheckResult = {
          success: true,
          message: "Session is healthy",
          profile: health.profile,
        };
      } else {
        sendProgress("HEALTH_CHECK_WARNING", `⚠️ Session health check: ${health.message}`);
        console.warn(`[IPC] Health check indicates invalid session - will NOT save`);
        healthCheckResult = {
          success: false,
          healthy: health.healthy,
          profileValid: health.profileValid,
          message: health.message,
        };

        return {
          success: false,
          session: result,
          profileUpload: profileUploadResult,
          healthCheck: healthCheckResult,
          accountLink: null,
          message: `Session health check failed. Session NOT saved. ${health.message}`,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Health check error caught - will NOT save session:`, error);

      sendProgress("HEALTH_CHECK_ERROR", `⚠️ Session health check error: ${errorMsg}`);

      event.sender.send("interactive-login-error", {
        error: `Session health check failed: ${errorMsg}`,
        timestamp: new Date().toISOString(),
        step: "HEALTH_CHECK",
      });

      healthCheckResult = {
        success: false,
        message: errorMsg,
      };

      return {
        success: false,
        session: result,
        profileUpload: profileUploadResult,
        healthCheck: healthCheckResult,
        accountLink: null,
        message: `Session health check error. Session NOT saved. ${errorMsg}`,
      };
    }
  } else if (!uploadToS3) {
    const missing = [];
    if (!userEmail) missing.push("userEmail");
    if (!vintedEmail) missing.push("vintedEmail");
    if (!hasValidToken) missing.push("accessToken");
    if (missing.length > 0) {
      sendProgress("HEALTH_CHECK_SKIPPED", `⏭️ Health check skipped (uploadToS3=${uploadToS3}, missing: ${missing.join(", ")})`);
    }
  }
  */

  // Check if there were any critical errors before proceeding to link
  if (profileUploadResult && !profileUploadResult.success) {
    console.error(`[IPC] NOT proceeding with linking - profile upload had errors`);
    return {
      success: false,
      session: result,
      profileUpload: profileUploadResult,
      healthCheck: healthCheckResult,
      accountLink: null,
      message: `Profile upload failed. Session NOT saved. ${profileUploadResult.message}`,
    };
  }

  // Only check health if we have a result and it failed
  // (Pre-flight validation would have already returned if health check failed)
  if (healthCheckResult && !healthCheckResult.success && uploadToS3) {
    console.error(`[IPC] NOT proceeding with linking - health check had errors`);
    return {
      success: false,
      session: result,
      profileUpload: profileUploadResult,
      healthCheck: healthCheckResult,
      accountLink: null,
      message: `Session health check failed. Session NOT saved. ${healthCheckResult.message}`,
    };
  }

  // Step 3: Link account via consolidated endpoint
  // Note: We use minimal session data since extracting from temporary profile is unreliable
  let uploadResult: any = null;
  if (userEmail && vintedEmail) {
    if (!accessToken) {
      sendProgress("LINK_FAILED", `⚠️ Access token required for account linking`);
      uploadResult = {
        success: false,
        message: "Access token is required. Please provide your authentication token.",
      };
    } else {
      try {
        sendProgress("LINK_START", `📝 Linking Vinted account...`);

        // The real Vinted cookies from the login profile, read before it
        // was deleted. The API stores them as the account's session, which
        // the backend's (Chromium) browser engine bootstraps from - it
        // cannot open the Firefox profile archive itself. This used to send
        // a placeholder cookie, so the engine started with no session.
        sendProgress("SESSION_COOKIES", `🍪 Sending ${result.vinted_cookies.length} Vinted cookie(s)`);
        const extractedSession = {
          profile_name: result.profile_name,
          profile_path: result.profile_path,
          url: result.url,
          cookies: result.vinted_cookies,
          storage: {
            localStorage: {},
            sessionStorage: {},
          },
          extracted_at: result.extracted_at,
        };

        // Link account via consolidated endpoint
        sendProgress("LINK_START", `📝 Linking Vinted account...`);
        const linkResult = await SessionUploadService.linkVintedAccount(extractedSession, {
          userEmail: userEmail || "",
          vintedEmail,
          vintedMemberId,
          accessToken,
          profileS3: profileUploadResult?.storageLocation,
        });

        if (linkResult.success) {
          sendProgress("LINK_COMPLETE", `✅ Account linked successfully (ID: ${linkResult.id})`);
          uploadResult = {
            success: true,
            id: linkResult.id,
            message: "Account linked successfully",
          };
        } else {
          if (linkResult.unauthorized) {
            signalUnauthorized(event.sender, new UnauthorizedError(linkResult.message));
          }
          sendProgress("LINK_WARNING", `⚠️ Account link note: ${linkResult.message}`);
          console.error(`[IPC] Account linking failed - will NOT save session:`, linkResult.message);
          uploadResult = {
            success: false,
            message: linkResult.message,
          };

          // Stop here - don't save session if linking fails
          return {
            success: false,
            session: result,
            profileUpload: profileUploadResult,
            healthCheck: healthCheckResult,
            accountLink: uploadResult,
            message: `Account linking failed. Session NOT saved. ${linkResult.message}`,
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[IPC] Account linking error caught - will NOT save session:`, error);

        sendProgress("LINK_FAILED", `⚠️ Account linking failed: ${errorMsg}`);

        // Send error event for UI display
        event.sender.send("interactive-login-error", {
          error: `Account linking failed: ${errorMsg}`,
          timestamp: new Date().toISOString(),
          step: "LINK",
        });

        uploadResult = {
          success: false,
          message: errorMsg,
        };

        // Stop here - error occurred, do not save session
        return {
          success: false,
          session: result,
          profileUpload: profileUploadResult,
          healthCheck: healthCheckResult,
          accountLink: uploadResult,
          message: `Account linking error. Session NOT saved. ${errorMsg}`,
        };
      }
    }
  }

  // Check if account linking failed
  if (uploadResult && !uploadResult.success) {
    console.error(`[IPC] NOT proceeding - account linking had errors`);
    return {
      success: false,
      session: result,
      profileUpload: profileUploadResult,
      healthCheck: healthCheckResult,
      accountLink: uploadResult,
      message: `Account linking failed. Session NOT saved. ${uploadResult.message}`,
    };
  }

  // If we reach here, all checks passed and account was successfully linked
  // Send final success progress message only if no errors occurred
  sendProgress("COMPLETE", `✅ Session saved successfully`);

  console.log(`[IPC] Flow completed successfully - session saved`);

  return {
    success: true,
    session: result,
    profileUpload: profileUploadResult,
    healthCheck: healthCheckResult,
    accountLink: uploadResult,
    message: uploadToS3
      ? `Profile uploaded to S3 and account linked successfully`
      : `Profile extracted and account linked successfully`,
  };
}

/**
 * Register all IPC handlers for the Electron main process
 */
function registerIPCHandlers() {
  console.log("[IPC] Registering all IPC handlers...");

  // Authenticated API calls (login/me/refresh/logout/link). These run here in
  // main so requests carry no Origin header and bypass CORS entirely.
  registerAuthHandlers();

  // Background updates (no-op outside an installed build)
  startUpdater();

  // Interactive login — open browser for user to log in, then extract & upload session to S3
  ipcMain.handle("vinted:interactiveLogin", async (event, options: {
    url: string;
    profileName: string;
    timeout?: number;
    userEmail?: string;
    vintedEmail?: string;
    vintedMemberId?: string;
    accessToken?: string;
    uploadToS3?: boolean;
  }) => {
    // The archive only exists to be uploaded; remove it however the flow ends
    // so each login doesn't leave ~20 MB behind in %TEMP%.
    let archivePath: string | undefined;
    // "Restart to update" waits until this is done
    const releaseBusy = markBusy();
    try {
      const {
        profileName,
        timeout = 300,
        userEmail,
        vintedEmail,
        vintedMemberId,
        accessToken,
        uploadToS3 = false,
      } = options;

      const url = assertVintedUrl(options.url);
      console.log(`[IPC] Starting interactive login: ${profileName} at ${url}`);

      // Send progress to renderer
      const sendProgress = (step: string, message: string) => {
        console.log(`[IPC] ${step}: ${message}`);
        event.sender.send("interactive-login-progress", {
          step,
          message,
          timestamp: new Date().toISOString(),
        });
      };

      // Validate there is a session to upload with
      if (!hasAccessToken(accessToken)) {
        console.error("[IPC] Access token is missing");
        sendProgress("AUTH_ERROR", `❌ Session error: Your session may have expired. Please log in again.`);
        event.sender.send("interactive-login-error", {
          error: "Session expired. Please log in again.",
          timestamp: new Date().toISOString(),
          step: "AUTH_VALIDATION",
        });
        return {
          success: false,
          message: "Session error: Access token missing. Please log in again.",
        };
      }

      sendProgress("START", `🚀 Opening Firefox for interactive login...`);
      sendProgress("URL", `Login URL: ${url}`);
      sendProgress("TIMEOUT", `User has ${timeout} seconds to log in`);

      const extractor = new InteractiveSessionExtractor();
      const result = await extractor.interactiveLogin({
        url,
        profileName,
        timeout,
      });
      archivePath = result.profile_archive_path;

      sendProgress("COMPRESS_COMPLETE", `✅ Profile compressed to tar.gz`);
      sendProgress("ARCHIVE", `Profile archive: ${(result.profile_archive_size / (1024 * 1024)).toFixed(2)}MB`);
      sendProgress("DURATION", `Login took ${(result.loginDuration / 1000).toFixed(1)} seconds`);
      // Informational: the step name avoids "WARNING"/"ERROR", which the UI
      // treats as a failure and would stop showing progress for.
      sendProgress(
        "LOGIN_STATE",
        result.vinted_login === "logged-in"
          ? "✅ Vinted session is logged in"
          : result.vinted_login === "anonymous"
            ? "ℹ️ Vinted cookies look logged out - uploading the profile anyway"
            : "ℹ️ Couldn't read the Vinted login state - uploading the profile anyway"
      );

      return await uploadAndLinkSession(event, result, {
        profileName,
        userEmail,
        vintedEmail,
        vintedMemberId,
        accessToken,
        uploadToS3,
        metadata: { loginUrl: url, type: "interactive-login" },
      }, sendProgress);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Interactive login failed: ${errorMessage}`);
      event.sender.send("interactive-login-error", {
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
      return {
        success: false,
        message: errorMessage,
      };
    } finally {
      releaseBusy();
      if (archivePath) {
        try {
          fs.rmSync(archivePath, { force: true });
        } catch (e) {
          console.warn(`[IPC] Could not delete profile archive ${archivePath}: ${e}`);
        }
      }
    }
  });

  // Firefox profiles on this machine and the Vinted session each one holds,
  // for importing a session the user already has instead of logging in again.
  ipcMain.handle("vinted:findFirefoxSessions", async () => {
    try {
      const profiles = await findFirefoxVintedSessions();
      console.log(
        `[IPC] Firefox profiles: ${profiles.map((p) => `${p.name} (${p.session.sites.map((s) => s.site).join("+") || p.session.state})`).join(", ") || "none"}`
      );
      return { success: true, profiles };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Could not list Firefox profiles: ${message}`);
      return { success: false, profiles: [], message };
    }
  });

  // Import the Vinted session from one of the user's Firefox profiles, then
  // upload and link it exactly as an interactive login would.
  ipcMain.handle("vinted:importFirefoxSession", async (event, options: {
    profilePath: string;
    /** The Vinted site to import, e.g. "vinted.es" (see importFirefoxSession). */
    site?: string;
    profileName: string;
    userEmail?: string;
    vintedEmail?: string;
    vintedMemberId?: string;
    accessToken?: string;
    uploadToS3?: boolean;
  }) => {
    let archivePath: string | undefined;
    // "Restart to update" waits until this is done
    const releaseBusy = markBusy();
    const sendProgress: ProgressSender = (step, message) => {
      console.log(`[IPC] ${step}: ${message}`);
      event.sender.send("interactive-login-progress", {
        step,
        message,
        timestamp: new Date().toISOString(),
      });
    };

    try {
      const { profilePath, profileName, userEmail, vintedEmail, accessToken, uploadToS3 = false } = options;

      if (!hasAccessToken(accessToken)) {
        event.sender.send("interactive-login-error", {
          error: "Session expired. Please log in again.",
          timestamp: new Date().toISOString(),
          step: "AUTH_VALIDATION",
        });
        return {
          success: false,
          message: "Session error: Access token missing. Please log in again.",
        };
      }

      // Only a path this app itself reported as a Firefox profile.
      const known = await findFirefoxVintedSessions();
      const profile = known.find((p) => path.resolve(p.path) === path.resolve(profilePath));
      if (!profile) {
        throw new Error("That Firefox profile no longer exists. Refresh the list and pick another.");
      }

      sendProgress("IMPORT_START", `🦊 Reading Vinted session from Firefox profile "${profile.name}"...`);
      // Normalized like the importer does ("www.vinted.es" -> "vinted.es"), so
      // the member id lookup below matches the site that was imported.
      const site = options.site
        ? vintedSiteOf(options.site)
        : profile.session.sites.length === 1 ? profile.session.sites[0].site : undefined;
      const result = await importFirefoxSession({ profilePath: profile.path, profileName, site });
      archivePath = result.profile_archive_path;

      // The member id is the logged-in token's subject; used unless the user
      // gave one.
      const siteSession = profile.session.sites.find((s) => s.site === site);
      const vintedMemberId = options.vintedMemberId?.trim() || siteSession?.userId;
      sendProgress(
        "LOGIN_STATE",
        `✅ Vinted session is logged in on ${site}` + (vintedMemberId ? ` (member ${vintedMemberId})` : "")
      );
      sendProgress(
        "COMPRESS_COMPLETE",
        `✅ Vinted-only profile packed (${(result.profile_archive_size / 1024).toFixed(0)}KB, ${result.vinted_cookies.length} cookies)`
      );

      return await uploadAndLinkSession(event, result, {
        profileName,
        userEmail,
        vintedEmail,
        vintedMemberId,
        accessToken,
        uploadToS3,
        metadata: { type: "firefox-import", firefoxProfile: profile.name, vintedSite: site },
      }, sendProgress);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Firefox session import failed: ${errorMessage}`);
      event.sender.send("interactive-login-error", {
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
      return { success: false, message: errorMessage };
    } finally {
      releaseBusy();
      if (archivePath) {
        try {
          fs.rmSync(archivePath, { force: true });
        } catch (e) {
          console.warn(`[IPC] Could not delete profile archive ${archivePath}: ${e}`);
        }
      }
    }
  });

  console.log("[IPC] All handlers registered successfully!");
}

module.exports = { registerIPCHandlers };
