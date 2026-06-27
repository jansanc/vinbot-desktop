import { ipcMain, dialog, app } from "electron";
import path from "path";
import { writeFileSync, mkdirSync } from "fs";
import { extractFirefoxProfileData } from "./extractors/firefox.extractor";
import { getChromeProfiles, getEdgeProfiles } from "./extractors/chrome.extractor";
import {
  getFirefoxProfilesDir,
  listFirefoxProfiles,
} from "../shared/browser-profiles";
import { getErrorMessage } from "../shared/vinted-utils";
import type { ExtractionData } from "../types";

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
    console.warn("Database save failed:", getErrorMessage(error));
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

function getFirefoxFallbackData(vintedBaseUrl: string) {
  const profilesDir = getFirefoxProfilesDir();
  const profiles = listFirefoxProfiles();
  if (profiles.length === 0) {
    throw new Error("No Firefox profiles found for fallback");
  }
  const profilePath = path.join(profilesDir, profiles[0]);
  return extractFirefoxProfileData(profilePath, vintedBaseUrl);
}

/**
 * Register all IPC handlers for the Electron main process
 */
function registerIPCHandlers() {
  ipcMain.handle("firefox:getProfiles", async () => {
    try {
      return listFirefoxProfiles();
    } catch (error) {
      console.error("Error getting Firefox profiles:", error);
      return [];
    }
  });

  ipcMain.handle("chrome:getProfiles", async () => {
    try {
      return getChromeProfiles();
    } catch (error) {
      console.error("Error getting Chrome profiles:", error);
      return [];
    }
  });

  ipcMain.handle("edge:getProfiles", async () => {
    try {
      return getEdgeProfiles();
    } catch (error) {
      console.error("Error getting Edge profiles:", error);
      return [];
    }
  });

  ipcMain.handle("extract:vinted:session", async (event, options) => {
    try {
      const { browser, profile, vintedBaseUrl } = options;

      if (browser === "firefox") {
        const profilesDir = getFirefoxProfilesDir();
        const profilePath = path.join(profilesDir, profile);
        return await extractFirefoxProfileData(profilePath, vintedBaseUrl);
      }

      console.log(`[${browser}] Profile extraction requested:`, profile);
      return await getFirefoxFallbackData(vintedBaseUrl);
    } catch (error) {
      throw new Error(`Extraction failed: ${getErrorMessage(error)}`);
    }
  });

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
        throw new Error(`Save failed: ${getErrorMessage(error)}`);
      }
    },
  );

  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle("vinted:validate", async (event, email, memberId) => {
    return {
      isValid: email.includes("@") && /^\d+$/.test(memberId),
    };
  });

  ipcMain.handle("open:external", async (event, url) => {
    const { shell } = require("electron");
    await shell.openExternal(url);
  });
}

module.exports = { registerIPCHandlers };
