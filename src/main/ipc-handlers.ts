import { ipcMain, dialog, app } from "electron";
import path from "path";
import os from "os";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { extractFirefoxProfileData } from "./extractors/firefox.extractor";
import { getChromeProfiles, extractChromeProfileData } from "./extractors/chrome.extractor";
import { getEdgeProfiles, extractEdgeProfileData } from "./extractors/edge.extractor";
import type { ExtractionData } from "../types";

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
}

module.exports = { registerIPCHandlers };
