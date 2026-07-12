import { ipcMain, dialog, app } from "electron";
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
import { InteractiveSessionExtractor } from "../modules/vinted/session/interactiveSessionExtractor";
import { SessionUploadService } from "../modules/vinted/session/sessionUpload.service";
import { ProfileUploader } from "../modules/vinted/profile/profileUploader";

// Dynamically import sql.js
const initSqlJs = require("sql.js");

async function saveToDatabase(
  data: ExtractionData,
  vintedEmail: string,
  userEmail: string,
  vintedMemberId: string,
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

/**
 * Register all IPC handlers for the Electron main process
 */
function registerIPCHandlers() {
  console.log("[IPC] Registering all IPC handlers...");

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
        const { vintedEmail, userEmail, vintedMemberId } = options;

        if (saveMethod === "database" || saveMethod === "both") {
          await saveToDatabase(data, vintedEmail, userEmail, vintedMemberId);
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

  // Open browser with specific profile
  ipcMain.handle("browser:open", async (event, browser, profile) => {
    try {
      const appData = process.env.APPDATA || "";
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

      let command: string;
      let args: string[] = [];

      if (browser === "firefox") {
        const firefoxPaths = [
          path.join(programFiles, "Mozilla Firefox", "firefox.exe"),
          path.join(programFilesX86, "Mozilla Firefox", "firefox.exe"),
        ];
        command = firefoxPaths.find(p => existsSync(p)) || firefoxPaths[0];
        if (profile) {
          args = ["-profile", path.join(appData, "Mozilla\\Firefox\\Profiles", profile)];
        }
      } else if (browser === "chrome") {
        const chromePaths = [
          path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
          path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        ];
        command = chromePaths.find(p => existsSync(p)) || chromePaths[0];
        if (profile && profile !== "Default") {
          args = [`--profile-directory=${profile}`];
        }
      } else if (browser === "edge") {
        const edgePaths = [
          path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        ];
        command = edgePaths.find(p => existsSync(p)) || edgePaths[0];
        if (profile && profile !== "Default") {
          args = [`--profile-directory=${profile}`];
        }
      } else {
        throw new Error(`Unsupported browser: ${browser}`);
      }

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

      // Upload to API endpoint
      const uploadResult = await SessionUploadService.uploadSessionToAPI(session, {
        userEmail,
        vintedEmail,
        vintedMemberId,
        accessToken,
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.message);
      }

      return {
        success: true,
        session_id: uploadResult.id,
        cookies_count: session.cookies.length,
        message: uploadResult.message,
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
    browser: "chrome" | "firefox" | "edge";
    timeout?: number;
    userEmail?: string;
    vintedEmail?: string;
    vintedMemberId?: string;
    accessToken?: string;
    uploadToS3?: boolean;
  }) => {
    try {
      const {
        url,
        profileName,
        browser,
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

      sendProgress("START", `🚀 Opening ${browser} for interactive login...`);
      sendProgress("URL", `Login URL: ${url}`);
      sendProgress("TIMEOUT", `User has ${timeout} seconds to log in`);

      const extractor = new InteractiveSessionExtractor();
      const result = await extractor.interactiveLogin({
        url,
        profileName,
        browser,
        timeout,
      });

      sendProgress("COMPRESS_COMPLETE", `✅ Profile compressed to tar.gz`);
      sendProgress("ARCHIVE", `Profile archive: ${(result.profile_archive_size / (1024 * 1024)).toFixed(2)}MB`);
      sendProgress("DURATION", `Login took ${(result.loginDuration / 1000).toFixed(1)} seconds`);

      // Upload tar.gz to S3 if requested
      let uploadResult: any = null;
      if (uploadToS3 && userEmail && vintedEmail) {
        if (!accessToken) {
          sendProgress("UPLOAD_FAILED", `⚠️ Access token required for S3 upload`);
          uploadResult = {
            success: false,
            message: "Access token is required to upload to S3. Please provide your authentication token.",
          };
        } else {
          sendProgress("UPLOAD_START", `📤 Uploading profile archive to S3...`);

          try {
            // Read the tar.gz file as binary
            const archiveBuffer = fs.readFileSync(result.profile_archive_path);

            // Import config to get API URL
            const { config } = await import("../config/config");

            // Make direct HTTP request from main process (bypassing ApiService which uses localStorage)
            const uploadUrl = `${config.api.baseUrl}/api/v1/integrations/vinted/profile/upload`;

            sendProgress("API_REQUEST", `Sending to: ${uploadUrl}`);

            const uploadResponse = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/gzip",
                "Authorization": `Bearer ${accessToken}`,
                "X-Browser": browser,
                "X-Profile-ID": profileName,
                "X-Profile-Name": profileName,
                "X-Vinted-Account-ID": vintedMemberId ?? profileName,
                "X-User-ID": userEmail,
                "X-User-Email": userEmail,
                "X-Vinted-Email": vintedEmail,
                "X-Vinted-Member-ID": vintedMemberId || "",
                "X-Compressed-Size": String(result.profile_archive_size),
                "X-Original-Size": String(result.profile_archive_size),
                "X-Metadata": JSON.stringify({
                  compressedAt: new Date(result.compressed_at).toISOString(),
                  loginUrl: url,
                  extractedAt: new Date(result.extracted_at).toISOString(),
                  type: "interactive-login",
                }),
              },
              body: archiveBuffer,
            });

            if (!uploadResponse.ok) {
              const errorText = await uploadResponse.text();
              let errorMsg = `${uploadResponse.status} ${uploadResponse.statusText}`;

              if (uploadResponse.status === 401) {
                errorMsg = "Authentication failed. Invalid or expired access token.";
              } else if (uploadResponse.status === 403) {
                errorMsg = "Permission denied. Check your access token and vinted email.";
              } else if (errorText) {
                try {
                  const errorData = JSON.parse(errorText);
                  errorMsg = errorData.message || errorMsg;
                } catch (e) {
                  errorMsg = errorText.substring(0, 200);
                }
              }

              throw new Error(errorMsg);
            }

            const uploadResponseData = await uploadResponse.json();

            console.log("[IPC] Upload response:", JSON.stringify(uploadResponseData, null, 2));
            sendProgress("API_RESPONSE", `Response: ${JSON.stringify(uploadResponseData).substring(0, 200)}`);

            // Response structure from sendResponse wrapper:
            // { status, message, data: { success, data: { id, storagePath, ... } } }
            // Access patterns to try:
            const uploadId =
              uploadResponseData?.data?.data?.id ||  // Nested: response.data.data.id
              uploadResponseData?.data?.id ||         // Flat: response.data.id
              uploadResponseData?.id;                  // Root: response.id

            const storageLocation =
              uploadResponseData?.data?.data?.storagePath ||
              uploadResponseData?.data?.storagePath ||
              uploadResponseData?.storagePath;

            if (uploadId) {
              sendProgress("UPLOAD_COMPLETE", `✅ Profile archive uploaded to S3`);
              sendProgress("S3_PATH", `S3 ID: ${uploadId}`);
              uploadResult = {
                success: true,
                id: uploadId,
                message: "Profile archive uploaded successfully",
                storageLocation: storageLocation,
              };
            } else {
              console.error("[IPC] Invalid response structure:", uploadResponseData);
              const responseStr = JSON.stringify(uploadResponseData, null, 2);
              throw new Error(`Upload response invalid:\n${responseStr.substring(0, 500)}`);
            }
          } catch (uploadError) {
            const uploadErrorMsg = uploadError instanceof Error ? uploadError.message : String(uploadError);
            sendProgress("UPLOAD_FAILED", `⚠️ Upload failed: ${uploadErrorMsg}`);
            uploadResult = {
              success: false,
              message: uploadErrorMsg,
            };
          }
        }
      }

      return {
        success: true,
        session: result,
        uploadResult: uploadResult,
        message: uploadToS3 ? `Profile extracted, compressed and uploaded to S3` : `Profile extracted and compressed to tar.gz`,
      };
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
        error: errorMessage,
      };
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
      const result = await ApiService.uploadBrowserProfile(options.accessToken, {
        browser: options.browser,
        profileId: options.profileId,
        profileName: options.profileName,
        vintedAccountId: options.vintedAccountId,
        userId: options.userId,
        profileData: buffer, // Complete profile as tar.gz binary
        compressedSize: compressedSize,
        originalSize: compressedSize, // Full archive size
        metadata: JSON.stringify({
          compressedAt: new Date().toISOString(),
          browser: options.browser,
          profileId: options.profileId,
          type: "tar.gz",
        }),
      });
      const uploadTime = Date.now() - startUpload;
      sendProgress("API_DONE", `✓ API upload complete in ${uploadTime}ms`);
      sendProgress("PROFILE_ID", `Profile ID: ${result.data.id}`);

      // Step 4: Clean up temp file
      sendProgress("CLEANUP", `Cleaning up temp files...`);
      fs.unlinkSync(tmpTarGzPath);
      sendProgress("CLEANUP_DONE", `✓ Temp file deleted`);

      const totalTime = compressTime + readTime + uploadTime;
      sendProgress("COMPLETE", `✅ Profile compressed and uploaded successfully to S3 in ${totalTime}ms`);

      return {
        success: true,
        profileId: result.data.id,
        message: `Profile uploaded successfully to S3`,
        storageLocation: result.data.storageLocation,
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
          const result = await ApiService.uploadBrowserProfile(options.accessToken, {
            browser: profile.browser,
            profileId: profile.id,
            profileName: profile.name,
            vintedAccountId: options.vintedAccountId,
            userId: options.userId,
            profileData: buffer, // Send as binary tar.gz Buffer
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
          console.log(`[IPC] Profile ID: ${result.data.id}`);

          // Clean up
          console.log(`[IPC] Cleaning up...`);
          fs.unlinkSync(tmpTarGzPath);
          console.log(`[IPC] ✓ Cleanup complete`);

          const totalTime = Date.now() - profileStartTime;
          console.log(`[IPC] ✅ ${profile.name} complete in ${totalTime}ms\n`);

          results.push({
            profileName: profile.name,
            success: true,
            profileId: result.data.id,
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
