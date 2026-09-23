import { ipcMain, dialog, app, type IpcMainInvokeEvent } from "electron";
import path from "path";
import os from "os";
import * as fs from "fs";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "fs";
import { spawn } from "child_process";
import { extractFirefoxProfileData } from "./extractors/firefox.extractor";
import { getChromeProfiles, extractChromeProfileData } from "./extractors/chrome.extractor";
import { getEdgeProfiles, extractEdgeProfileData } from "./extractors/edge.extractor";
import type { ExtractionData } from "../types";
import { SessionExtractor, type ExtractedSession } from "../modules/vinted/session/sessionExtractor";
import {
  InteractiveSessionExtractor,
  type InteractiveLoginResult,
} from "../modules/vinted/session/interactiveSessionExtractor";
import {
  findFirefoxVintedSessions,
  importFirefoxSession,
} from "../modules/vinted/session/firefoxSessionImporter";
import { SessionUploadService } from "../modules/vinted/session/sessionUpload.service";
import { ProfileUploader } from "../modules/vinted/profile/profileUploader";
import { registerAuthHandlers } from "./api/auth.handlers";
import { tokenStore } from "./api/token-store";

// Dynamically import sql.js
const initSqlJs = require("sql.js");

async function saveToDatabase(
  data: ExtractionData,
  vintedEmail: string,
  userEmail: string,
  vintedMemberId: string,
  accessToken?: string,
) {
  try {
    const { saveFirefoxExtractionData } = await import(
      "../modules/vinted/auth/vintedAuth.service"
    );
    await saveFirefoxExtractionData(
      vintedEmail,
      data.fingerprint,
      {
        cookies: data.authentication.cookies,
        origins: data.authentication.origins,
      },
      userEmail,
      vintedMemberId,
      accessToken,
    );
    console.log("Successfully saved to database");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("Database save failed:", msg);
  }
}

async function saveToLocalFiles(data: ExtractionData) {
  const appDataPath = app.getPath("userData");
  const authDir = path.join(appDataPath, "vinted-auth");
  mkdirSync(authDir, { recursive: true });

  const fingerprintFilePath = path.join(authDir, "fingerprint.json");
  const fingerprintData = {
    ...data.fingerprint,
    extractedAt: new Date().toISOString(),
  };
  writeFileSync(fingerprintFilePath, JSON.stringify(fingerprintData, null, 2));

  const authFilePath = path.join(authDir, "auth-vinted.json");
  const storageState = {
    cookies: data.authentication.cookies,
    origins: data.authentication.origins,
    extractedAt: new Date().toISOString(),
  };
  writeFileSync(authFilePath, JSON.stringify(storageState, null, 2));

  console.log(`Files saved to: ${authDir}`);
}

interface ProfileInfo {
  id: string;
  name: string;
}

async function getFirefoxProfilesWithNames(): Promise<ProfileInfo[]> {
  try {
    const appData = process.env.APPDATA || "";
    const firefoxProfilesDir = path.join(appData, "Mozilla\\Firefox\\Profiles");
    const profileGroupsDir = path.join(appData, "Mozilla\\Firefox\\Profile Groups");

    if (!existsSync(firefoxProfilesDir)) {
      console.warn("[Firefox] Firefox profiles directory not found");
      return [];
    }

    let profileNameMap: Record<string, string> = {};

    // Try to read profile names from the SQLite database in Profile Groups
    if (existsSync(profileGroupsDir)) {
      try {
        const files = readdirSync(profileGroupsDir);
        console.log("[Firefox] Files in Profile Groups:", files);
        const dbFile = files.find((f) => f.endsWith(".sqlite"));

        if (dbFile) {
          const dbPath = path.join(profileGroupsDir, dbFile);
          console.log("[Firefox] Found database:", dbPath);

          try {
            // Read the database file
            const fileBuffer = readFileSync(dbPath);
            console.log("[Firefox] Read database file, size:", fileBuffer.length);

            // Initialize SQL.js
            const SQL = await initSqlJs();
            const db = new (SQL as any).Database(fileBuffer);

            try {
              // Query the Profiles table for friendly names
              try {
                const result = db.exec("SELECT path, name FROM Profiles");
                if (result.length > 0) {
                  const columns = result[0].columns;
                  const rows = result[0].values;
                  console.log(
                    `[Firefox] Profiles table (${rows.length} rows, columns: ${columns.join(", ")})`
                  );

                  for (let i = 0; i < rows.length; i++) {
                    const row = rows[i] as any[];
                    const pathIdx = columns.indexOf("path");
                    const nameIdx = columns.indexOf("name");

                    if (pathIdx >= 0 && nameIdx >= 0) {
                      let profilePath = row[pathIdx] as string;
                      const friendlyName = row[nameIdx] as string;

                      // Remove "Profiles\\" or "Profiles/" prefix
                      if (profilePath.startsWith("Profiles\\")) {
                        profilePath = profilePath.substring(9);
                      } else if (profilePath.startsWith("Profiles/")) {
                        profilePath = profilePath.substring(9);
                      }

                      profileNameMap[profilePath] = friendlyName;
                      console.log(
                        `[Firefox] ✓ Mapped "${profilePath}" -> "${friendlyName}"`
                      );
                    }
                  }
                }
              } catch (e) {
                console.log("[Firefox] Error querying Profiles table:", e);
              }

              console.log(
                "[Firefox] Final profile name map:",
                JSON.stringify(profileNameMap)
              );
            } finally {
              db.close();
            }
          } catch (error) {
            console.warn("[Firefox] Error reading database with sql.js:", error);
          }
        } else {
          console.warn("[Firefox] No .sqlite files found in Profile Groups");
        }
      } catch (error) {
        console.warn("[Firefox] Error reading Profile Groups database:", error);
      }
    } else {
      console.warn("[Firefox] Profile Groups folder not found at:", profileGroupsDir);
    }

    // Fallback to profiles.ini if database didn't provide names
    if (Object.keys(profileNameMap).length === 0) {
      console.log("[Firefox] No names from database, trying profiles.ini");
      const profilesIniPath = path.join(appData, "Mozilla\\Firefox\\profiles.ini");
      if (existsSync(profilesIniPath)) {
        try {
          const iniContent = readFileSync(profilesIniPath, "utf-8");
          const lines = iniContent.split("\n");
          let currentPath = "";
          let currentName = "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("[Profile")) {
              if (currentPath && currentName) {
                profileNameMap[currentPath] = currentName;
              }
              currentPath = "";
              currentName = "";
            } else if (trimmed.startsWith("Path=")) {
              let pathValue = trimmed.substring(5).trim();
              if (pathValue.startsWith("Profiles/")) {
                pathValue = pathValue.substring(9);
              }
              currentPath = pathValue;
            } else if (trimmed.startsWith("Name=")) {
              currentName = trimmed.substring(5).trim();
            }
          }
          if (currentPath && currentName) {
            profileNameMap[currentPath] = currentName;
          }
        } catch (e) {
          console.warn("[Firefox] Failed to parse profiles.ini:", e);
        }
      }
    }

    const profiles = readdirSync(firefoxProfilesDir);
    const result = profiles
      .filter((f: string) => f.includes("."))
      .map((id) => {
        const name = profileNameMap[id] || id;
        console.log(`[Firefox] "${id}" -> "${name}"`);
        return { id, name };
      });

    console.log("[Firefox] Returning profiles:", result);
    return result;
  } catch (error) {
    console.error("[Firefox] Error getting profiles with names:", error);
    return [];
  }
}

function getChromeProfilesWithNames(): ProfileInfo[] {
  try {
    const localAppData = process.env.LOCALAPPDATA || "";
    const chromeDataDir = path.join(localAppData, "Google", "Chrome", "User Data");

    if (!existsSync(chromeDataDir)) {
      console.warn("[Chrome] Chrome data directory not found");
      return [];
    }

    const localStatePath = path.join(chromeDataDir, "Local State");
    let profileNames: Record<string, string> = {};

    if (existsSync(localStatePath)) {
      try {
        const localStateContent = readFileSync(localStatePath, "utf-8");
        const localState = JSON.parse(localStateContent);
        console.log("[Chrome] Loaded Local State, checking for profile info");

        if (localState.profile?.info_cache) {
          Object.entries(localState.profile.info_cache).forEach(([key, value]: [string, any]) => {
            profileNames[key] = value.name || key;
            console.log(`[Chrome] Profile ${key}: ${value.name || key}`);
          });
        } else {
          console.warn("[Chrome] No profile.info_cache found in Local State");
        }
      } catch (e) {
        console.warn("[Chrome] Failed to parse Local State:", e);
      }
    } else {
      console.warn("[Chrome] Local State file not found at:", localStatePath);
    }

    const items = readdirSync(chromeDataDir);
    const profiles = items.filter(
      (item) =>
        item.startsWith("Profile") || item === "Default" || item === "Guest Profile",
    );

    console.log("[Chrome] Found profile directories:", profiles);
    const result = profiles.map((id) => ({
      id,
      name: profileNames[id] || id,
    }));
    console.log("[Chrome] Returning profiles:", result);

    return result;
  } catch (error) {
    console.error("[Chrome] Error getting profiles with names:", error);
    return [];
  }
}

function getEdgeProfilesWithNames(): ProfileInfo[] {
  try {
    const localAppData = process.env.LOCALAPPDATA || "";
    const edgeDataDir = path.join(localAppData, "Microsoft", "Edge", "User Data");

    if (!existsSync(edgeDataDir)) {
      console.warn("[Edge] Edge data directory not found");
      return [];
    }

    const localStatePath = path.join(edgeDataDir, "Local State");
    let profileNames: Record<string, string> = {};

    if (existsSync(localStatePath)) {
      try {
        const localStateContent = readFileSync(localStatePath, "utf-8");
        const localState = JSON.parse(localStateContent);
        console.log("[Edge] Loaded Local State, checking for profile info");

        if (localState.profile?.info_cache) {
          Object.entries(localState.profile.info_cache).forEach(([key, value]: [string, any]) => {
            profileNames[key] = value.name || key;
            console.log(`[Edge] Profile ${key}: ${value.name || key}`);
          });
        } else {
          console.warn("[Edge] No profile.info_cache found in Local State");
        }
      } catch (e) {
        console.warn("[Edge] Failed to parse Local State:", e);
      }
    } else {
      console.warn("[Edge] Local State file not found");
    }

    const items = readdirSync(edgeDataDir);
    const profiles = items.filter(
      (item) =>
        item.startsWith("Profile") || item === "Default" || item === "Guest Profile",
    );

    console.log("[Edge] Found profile directories:", profiles);
    const result = profiles.map((id) => ({
      id,
      name: profileNames[id] || id,
    }));
    console.log("[Edge] Returning profiles:", result);

    return result;
  } catch (error) {
    console.error("[Edge] Error getting profiles with names:", error);
    return [];
  }
}

type ProgressSender = (step: string, message: string) => void;

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
    accessToken: string;
    uploadToS3: boolean;
    /** Stored with the uploaded profile; `type` says where the session came from. */
    metadata: Record<string, unknown>;
  },
  sendProgress: ProgressSender
) {
  const { profileName, userEmail, vintedEmail, vintedMemberId, accessToken, uploadToS3, metadata } = options;

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

  // Get available Firefox profiles
  ipcMain.handle("firefox:getProfiles", async () => {
    try {
      return await getFirefoxProfilesWithNames();
    } catch (error) {
      console.error("Error getting Firefox profiles:", error);
      return [];
    }
  });

  // Get available Chrome profiles
  ipcMain.handle("chrome:getProfiles", async () => {
    try {
      return getChromeProfilesWithNames();
    } catch (error) {
      console.error("Error getting Chrome profiles:", error);
      return [];
    }
  });

  // Get available Edge profiles
  ipcMain.handle("edge:getProfiles", async () => {
    try {
      return getEdgeProfilesWithNames();
    } catch (error) {
      console.error("Error getting Edge profiles:", error);
      return [];
    }
  });

  // Extract Vinted session data
  ipcMain.handle("extract:vinted:session", async (event, options) => {
    try {
      const { browser, profile, vintedBaseUrl } = options;
      const appData = process.env.APPDATA || "";

      if (browser === "firefox") {
        const firefoxProfilesDir = path.join(
          appData,
          "Mozilla\\Firefox\\Profiles",
        );
        const profilePath = path.join(firefoxProfilesDir, profile);
        const extractedData = await extractFirefoxProfileData(
          profilePath,
          vintedBaseUrl,
        );
        return extractedData;
      } else if (browser === "chrome") {
        const extractedData = await extractChromeProfileData(
          profile || "Default",
          "chrome",
          vintedBaseUrl,
        );
        return extractedData;
      } else if (browser === "edge") {
        const extractedData = await extractEdgeProfileData(
          profile || "Default",
          vintedBaseUrl,
        );
        return extractedData;
      }

      throw new Error(`Unsupported browser: ${browser}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Extraction failed: ${errorMessage}`);
    }
  });

  // Save extraction data
  ipcMain.handle(
    "save:extraction",
    async (event, data, saveMethod, options) => {
      try {
        const { vintedEmail, userEmail, vintedMemberId, accessToken } = options;

        if (saveMethod === "database" || saveMethod === "both") {
          await saveToDatabase(data, vintedEmail, userEmail, vintedMemberId, accessToken);
        }

        if (saveMethod === "file" || saveMethod === "both") {
          await saveToLocalFiles(data);
        }

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(`Save failed: ${errorMessage}`);
      }
    },
  );

  // Select directory dialog
  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.filePaths[0] || null;
  });

  // Validate Vinted credentials
  ipcMain.handle("vinted:validate", async (event, email, memberId) => {
    // Simple validation
    return {
      isValid: email.includes("@") && /^\d+$/.test(memberId),
    };
  });

  // Open external links
  ipcMain.handle("open:external", async (event, url) => {
    const { shell } = require("electron");
    await shell.openExternal(url);
  });

  // Open a Firefox profile. This app only ever launches Firefox; Chrome and
  // Edge profiles can still be read for cookies, but are never started.
  ipcMain.handle("browser:open", async (event, browser, profile) => {
    try {
      if (browser !== "firefox") {
        throw new Error(`Only Firefox can be opened from this app (got: ${browser})`);
      }

      const appData = process.env.APPDATA || "";
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

      const firefoxPaths = [
        path.join(programFiles, "Mozilla Firefox", "firefox.exe"),
        path.join(programFilesX86, "Mozilla Firefox", "firefox.exe"),
      ];
      const command = firefoxPaths.find(p => existsSync(p)) || firefoxPaths[0];
      const args = profile
        ? ["-profile", path.join(appData, "Mozilla\\Firefox\\Profiles", profile)]
        : [];

      spawn(command, args, { detached: true, stdio: "ignore" });
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to open browser: ${errorMessage}`);
    }
  });

  // Extract and upload Vinted session
  ipcMain.handle("vinted:extractAndUploadSession", async (event, options) => {
    try {
      const {
        browser,
        profileId,
        userEmail,
        vintedEmail,
        vintedMemberId,
        accessToken,
        domain = ".vinted.com",
      } = options;

      console.log(`[IPC] Extracting session: browser=${browser}, profile=${profileId}`);

      const extractor = new SessionExtractor();
      const session = await extractor.extractSession(
        browser as "chrome" | "firefox" | "edge",
        profileId,
        domain
      );

      console.log(`[IPC] Session extracted: ${session.cookies.length} cookies found`);

      // Link account via consolidated endpoint
      const linkResult = await SessionUploadService.linkVintedAccount(session, {
        userEmail,
        vintedEmail,
        vintedMemberId,
        accessToken,
      });

      if (!linkResult.success) {
        throw new Error(linkResult.message);
      }

      return {
        success: true,
        session_id: linkResult.id,
        cookies_count: session.cookies.length,
        message: linkResult.message,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Session extraction/upload failed: ${errorMessage}`);
      throw new Error(`Session extraction/upload failed: ${errorMessage}`);
    }
  });

  // Extract session without uploading (for debugging)
  ipcMain.handle("vinted:extractSession", async (event, options) => {
    try {
      const {
        browser,
        profileId,
        domain = ".vinted.com",
      } = options;

      console.log(`[IPC] Extracting session: browser=${browser}, profile=${profileId}`);

      const extractor = new SessionExtractor();
      const session = await extractor.extractSession(
        browser as "chrome" | "firefox" | "edge",
        profileId,
        domain
      );

      return {
        success: true,
        profile_name: session.profile_name,
        cookies_count: session.cookies.length,
        extracted_at: new Date(session.extracted_at).toISOString(),
        sample_cookies: session.cookies.slice(0, 3).map(c => ({
          name: c.name,
          domain: c.domain,
        })),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Session extraction failed: ${errorMessage}`);
      throw new Error(`Session extraction failed: ${errorMessage}`);
    }
  });

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
    try {
      const {
        url,
        profileName,
        timeout = 300,
        userEmail,
        vintedEmail,
        vintedMemberId,
        accessToken,
        uploadToS3 = false,
      } = options;

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

      // Validate access token is present
      if (!accessToken || accessToken.trim().length === 0) {
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

      if (!accessToken || accessToken.trim().length === 0) {
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
      const site = options.site ?? (profile.session.sites.length === 1 ? profile.session.sites[0].site : undefined);
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
      if (archivePath) {
        try {
          fs.rmSync(archivePath, { force: true });
        } catch (e) {
          console.warn(`[IPC] Could not delete profile archive ${archivePath}: ${e}`);
        }
      }
    }
  });

  // Download storageState from API
  ipcMain.handle("vinted:downloadProfile", async (event, options) => {
    try {
      const {
        profileId,
        accessToken,
        outputPath,
      } = options;

      console.log(`[IPC] Downloading storageState: ${profileId}`);

      const { config } = await import("../config/config");
      const { ApiService } = await import("../services/api.service");

      // Download storageState JSON from API
      const response = await fetch(
        `${config.api.baseUrl}${config.api.endpoints.vinted.profileDownload}/${profileId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const storageState = await response.json();
      const storageStateBuffer = Buffer.from(JSON.stringify(storageState));

      // Save to disk if output path provided
      if (outputPath) {
        fs.writeFileSync(outputPath, storageStateBuffer);
        console.log(`[IPC] StorageState saved to: ${outputPath}`);
      }

      return {
        success: true,
        sizeBytes: storageStateBuffer.length,
        message: `StorageState downloaded successfully (${(storageStateBuffer.length / 1024).toFixed(1)}KB)`,
        storageState,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[IPC] StorageState download failed: ${errorMessage}`);
      throw new Error(`StorageState download failed: ${errorMessage}`);
    }
  });

  // --- Profile Upload to S3 ---

  console.log("[IPC] Registering profile upload handlers...");

  /**
   * Upload a single profile to S3 via backend API
   */
  ipcMain.handle("vinted:uploadProfile", async (event, options: {
    browser: "chrome" | "firefox" | "edge";
    profileId: string;
    profileName: string;
    profilePath: string;
    accessToken: string;
    vintedAccountId: string;
    userId: string;
    vintedEmail: string;
  }) => {
    const sendProgress = (step: string, message: string) => {
      console.log(`[IPC] ${step}: ${message}`);
      event.sender.send("upload-progress-log", { step, message, timestamp: new Date().toISOString() });
    };

    try {
      sendProgress("START", `Starting profile upload: ${options.profileName}`);

      // Construct the full profile path
      const localAppData = process.env.LOCALAPPDATA || "";
      const appData = process.env.APPDATA || "";
      let fullProfilePath = options.profilePath;

      // If profilePath is just an ID or relative, construct the full path
      if (!fullProfilePath.includes("\\User Data") && !fullProfilePath.includes("\\Profiles")) {
        switch (options.browser) {
          case "chrome":
            // Chrome uses LOCALAPPDATA
            fullProfilePath = path.join(localAppData, "Google\\Chrome\\User Data", options.profileId);
            break;
          case "firefox":
            // Firefox uses APPDATA
            fullProfilePath = path.join(appData, "Mozilla\\Firefox\\Profiles", options.profileId);
            break;
          case "edge":
            // Edge uses LOCALAPPDATA
            fullProfilePath = path.join(localAppData, "Microsoft\\Edge\\User Data", options.profileId);
            break;
        }
      }

      console.log(`[IPC] Profile path: ${fullProfilePath}`);

      // Step 1: Compress entire profile folder to tar.gz
      const uploader = new ProfileUploader();
      const tmpTarGzPath = path.join(os.tmpdir(), `profile_${Date.now()}.tar.gz`);
      sendProgress("COMPRESS_START", `🚀 Compressing entire profile folder to tar.gz...`);
      sendProgress("SOURCE_DIR", `Source directory: ${fullProfilePath}`);

      const startCompress = Date.now();
      const compressedSize = await uploader.compressProfileToTarGz(
        fullProfilePath,
        tmpTarGzPath,
        (msg: string) => sendProgress("COMPRESS_DETAIL", msg)
      );
      const compressTime = Date.now() - startCompress;
      sendProgress("COMPRESS_DONE", `✅ Profile compressed to tar.gz in ${compressTime}ms (${(compressedSize / (1024 * 1024)).toFixed(2)}MB)`);

      // Step 2: Read tar.gz file as binary
      sendProgress("READ_START", `Reading tar.gz file...`);
      const startRead = Date.now();
      const buffer = fs.readFileSync(tmpTarGzPath);
      const readTime = Date.now() - startRead;
      sendProgress("READ_DONE", `✓ Read tar.gz (${buffer.length} bytes in ${readTime}ms)`);

      // Step 3: Call API to upload
      sendProgress("API_START", `Uploading to API...`);
      const { ApiService } = await import("../services/api.service");
      const { config } = await import("../config/config");
      sendProgress("API_ENDPOINT", `${config.api.endpoints.vinted.profileUpload} (binary POST)`);
      sendProgress("PAYLOAD_SIZE", `${buffer.length} bytes (${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`);

      const startUpload = Date.now();
      sendProgress("API_CALLING", `Making API request...`);
      const result = await ApiService.uploadBrowserProfile(tokenStore.resolveAccessToken(options.accessToken), {
        browser: options.browser,
        profileId: options.profileId,
        profileName: options.profileName,
        vintedAccountId: options.vintedAccountId,
        userId: options.userId,
        profileData: buffer,
        compressedSize: compressedSize,
        originalSize: compressedSize,
        metadata: JSON.stringify({
          compressedAt: new Date().toISOString(),
          browser: options.browser,
          profileId: options.profileId,
          type: "tar.gz",
        }),
        vintedEmail: options.vintedEmail,
      });
      const uploadTime = Date.now() - startUpload;
      sendProgress("API_DONE", `✓ API upload complete in ${uploadTime}ms`);
      sendProgress("PROFILE_ID", `Profile ID: ${result.id}`);
      sendProgress("S3_PATH", `S3 Path: ${result.storagePath}`);

      // Step 4: Clean up temp file
      sendProgress("CLEANUP", `Cleaning up temp files...`);
      fs.unlinkSync(tmpTarGzPath);
      sendProgress("CLEANUP_DONE", `✓ Temp file deleted`);

      const totalTime = compressTime + readTime + uploadTime;
      sendProgress("COMPLETE", `✅ Profile compressed and uploaded successfully to S3 in ${totalTime}ms`);

      return {
        success: true,
        profileId: result.id,
        message: `Profile uploaded successfully to S3`,
        storageLocation: result.storagePath,
        profile_archive_size: compressedSize,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Profile upload failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  /**
   * Upload multiple profiles from the same browser to S3
   */
  ipcMain.handle("vinted:batchUploadProfiles", async (event, options: {
    profiles: Array<{
      id: string;
      name: string;
      path: string;
      browser: "chrome" | "firefox" | "edge";
    }>;
    accessToken: string;
    vintedAccountId: string;
    userId: string;
    vintedEmail: string;
  }) => {
    try {
      console.log(`[IPC] Starting batch upload of ${options.profiles.length} profiles`);

      const results: Array<{
        profileName: string;
        success: boolean;
        profileId?: string;
        error?: string;
        compressedSize?: number;
      }> = [];

      const uploader = new ProfileUploader();

      for (let i = 0; i < options.profiles.length; i++) {
        const profile = options.profiles[i];
        console.log(`\n[IPC] ===== BATCH UPLOAD ${i + 1}/${options.profiles.length}: ${profile.name} =====`);
        const profileStartTime = Date.now();

        try {
          // Construct the full profile path
          const localAppData = process.env.LOCALAPPDATA || "";
          const appData = process.env.APPDATA || "";
          let fullProfilePath = profile.path;

          // If path is just an ID or relative, construct the full path
          if (!fullProfilePath.includes("\\User Data") && !fullProfilePath.includes("\\Profiles")) {
            switch (profile.browser) {
              case "chrome":
                // Chrome uses LOCALAPPDATA
                fullProfilePath = path.join(localAppData, "Google\\Chrome\\User Data", profile.id);
                break;
              case "firefox":
                // Firefox uses APPDATA
                fullProfilePath = path.join(appData, "Mozilla\\Firefox\\Profiles", profile.id);
                break;
              case "edge":
                // Edge uses LOCALAPPDATA
                fullProfilePath = path.join(localAppData, "Microsoft\\Edge\\User Data", profile.id);
                break;
            }
          }

          console.log(`[IPC] Path: ${fullProfilePath}`);

          // Compress entire profile folder to tar.gz
          console.log(`[IPC] Compressing entire profile folder to tar.gz...`);
          const tmpTarGzPath = path.join(os.tmpdir(), `profile_${Date.now()}_${i}.tar.gz`);
          const startCompress = Date.now();
          const compressedSize = await uploader.compressProfileToTarGz(
            fullProfilePath,
            tmpTarGzPath,
            (msg: string) => {
              console.log(`[IPC] COMPRESS: ${msg}`);
            }
          );
          const compressTime = Date.now() - startCompress;
          console.log(`[IPC] ✓ Profile compressed to tar.gz: ${(compressedSize / (1024 * 1024)).toFixed(2)}MB in ${compressTime}ms`);

          // Read tar.gz file
          console.log(`[IPC] Reading tar.gz file...`);
          const startRead = Date.now();
          const buffer = fs.readFileSync(tmpTarGzPath);
          const readTime = Date.now() - startRead;
          console.log(`[IPC] ✓ Read: ${buffer.length} bytes in ${readTime}ms (${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`);

          // For full profile, we don't have separate "compressed" and "original" sizes
          const originalSize = compressedSize;

          // Upload
          console.log(`[IPC] Uploading to API...`);
          const startUpload = Date.now();
          const { ApiService } = await import("../services/api.service");
          const result = await ApiService.uploadBrowserProfile(tokenStore.resolveAccessToken(options.accessToken), {
            browser: profile.browser,
            profileId: profile.id,
            profileName: profile.name,
            vintedAccountId: options.vintedAccountId,
            userId: options.userId,
            profileData: buffer,
            compressedSize: compressedSize,
            originalSize: originalSize,
            metadata: JSON.stringify({
              compressedAt: new Date().toISOString(),
              browser: profile.browser,
              type: "tar.gz",
            }),
            vintedEmail: options.vintedEmail,
          });
          const uploadTime = Date.now() - startUpload;
          console.log(`[IPC] ✓ Uploaded in ${uploadTime}ms`);
          console.log(`[IPC] Profile ID: ${result.id}`);
          console.log(`[IPC] S3 Path: ${result.storagePath}`);

          // Clean up
          console.log(`[IPC] Cleaning up...`);
          fs.unlinkSync(tmpTarGzPath);
          console.log(`[IPC] ✓ Cleanup complete`);

          const totalTime = Date.now() - profileStartTime;
          console.log(`[IPC] ✅ ${profile.name} complete in ${totalTime}ms\n`);

          results.push({
            profileName: profile.name,
            success: true,
            profileId: result.id,
            compressedSize: compressedSize,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const totalTime = Date.now() - profileStartTime;
          console.error(`[IPC] ❌ ${profile.name} failed after ${totalTime}ms: ${errorMessage}\n`);
          results.push({
            profileName: profile.name,
            success: false,
            error: errorMessage,
          });
        }

        // Send progress to renderer
        event.sender.send("batch-upload-progress", {
          current: i + 1,
          total: options.profiles.length,
          profileName: profile.name,
          results: results,
        });
      }

      console.log(
        `[IPC] Batch upload complete: ${results.filter((r) => r.success).length}/${results.length} successful`
      );

      return {
        success: true,
        summary: {
          total: options.profiles.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
        results: results,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Batch upload failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  console.log("[IPC] All handlers registered successfully!");
}

// Helper function to get directory size synchronously
function getDirectorySizeSync(dirPath: string): number {
  let size = 0;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      size += getDirectorySizeSync(filePath);
    } else {
      size += stat.size;
    }
  }

  return size;
}

module.exports = { registerIPCHandlers };
