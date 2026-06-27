import { ipcMain, dialog, app } from "electron";
import path from "path";
import os from "os";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { extractFirefoxProfileData } from "./extractors/firefox.extractor";
import { getChromeProfiles, getEdgeProfiles } from "./extractors/chrome.extractor";
import type { ExtractionData } from "../types";

async function saveToDatabase(
  data: ExtractionData,
  vintedEmail: string,
  userEmail: string,
  vintedMemberId: string,
) {
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

/**
 * Register all IPC handlers for the Electron main process
 */
function registerIPCHandlers() {
  // Get available Firefox profiles
  ipcMain.handle("firefox:getProfiles", async () => {
    const appData = process.env.APPDATA || "";
    const firefoxProfilesDir = path.join(
      appData,
      "Mozilla\\Firefox\\Profiles",
    );

    if (!existsSync(firefoxProfilesDir)) {
      return [];
    }

    const profiles = readdirSync(firefoxProfilesDir);
    return profiles.filter((f: string) => f.includes(".") || f.includes(" "));
  });

  // Get available Chrome profiles
  ipcMain.handle("chrome:getProfiles", async () => {
    return getChromeProfiles();
  });

  // Get available Edge profiles
  ipcMain.handle("edge:getProfiles", async () => {
    return getEdgeProfiles();
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
        // For Chrome/Edge, we'll extract Firefox data for now
        // Full Chrome/Edge extraction can be implemented later
        console.log("[Chrome] Profile extraction requested:", profile);
        const firefoxProfilesDir = path.join(
          appData,
          "Mozilla\\Firefox\\Profiles",
        );
        const profiles = readdirSync(firefoxProfilesDir).filter(
          (f: string) => f.includes(".") || f.includes(" "),
        );
        if (profiles.length === 0) {
          throw new Error("No Firefox profiles found for fallback");
        }
        const profilePath = path.join(firefoxProfilesDir, profiles[0]);
        const extractedData = await extractFirefoxProfileData(
          profilePath,
          vintedBaseUrl,
        );
        return extractedData;
      } else if (browser === "edge") {
        // Same fallback for Edge
        console.log("[Edge] Profile extraction requested:", profile);
        const firefoxProfilesDir = path.join(
          appData,
          "Mozilla\\Firefox\\Profiles",
        );
        const profiles = readdirSync(firefoxProfilesDir).filter(
          (f: string) => f.includes(".") || f.includes(" "),
        );
        if (profiles.length === 0) {
          throw new Error("No Firefox profiles found for fallback");
        }
        const profilePath = path.join(firefoxProfilesDir, profiles[0]);
        const extractedData = await extractFirefoxProfileData(
          profilePath,
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
      const { vintedEmail, userEmail, vintedMemberId } = options;
      const warnings: string[] = [];

      if (saveMethod === "database" || saveMethod === "both") {
        try {
          await saveToDatabase(data, vintedEmail, userEmail, vintedMemberId);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (saveMethod === "database") {
            throw new Error(`Database save failed: ${msg}`);
          }
          warnings.push(`Database save failed: ${msg}`);
        }
      }

      if (saveMethod === "file" || saveMethod === "both") {
        try {
          await saveToLocalFiles(data);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (saveMethod === "file") {
            throw new Error(`File save failed: ${msg}`);
          }
          warnings.push(`File save failed: ${msg}`);
        }
      }

      return {
        success: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  );

  // Select directory dialog
  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled) {
      return null;
    }
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
    if (typeof url !== "string" || (!url.startsWith("https://") && !url.startsWith("http://"))) {
      throw new Error("Invalid URL: only http and https URLs are allowed");
    }
    const { shell } = require("electron");
    await shell.openExternal(url);
  });
}

module.exports = { registerIPCHandlers };
