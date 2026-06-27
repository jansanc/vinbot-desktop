import path from "path";
import os from "os";
import { existsSync, readdirSync } from "fs";

export function getFirefoxProfilesDir(): string {
  const appData = process.env.APPDATA || "";
  return path.join(appData, "Mozilla", "Firefox", "Profiles");
}

export function listFirefoxProfiles(): string[] {
  const profilesDir = getFirefoxProfilesDir();

  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir).filter(
    (f: string) => f.includes(".") || f.includes(" "),
  );
}

interface ChromiumBrowserConfig {
  win32: string[];
  darwin: string[];
  linux: string[];
}

const CHROMIUM_BROWSER_PATHS: Record<"chrome" | "edge", ChromiumBrowserConfig> = {
  chrome: {
    win32: ["Google", "Chrome", "User Data"],
    darwin: ["Google", "Chrome"],
    linux: ["google-chrome"],
  },
  edge: {
    win32: ["Microsoft", "Edge", "User Data"],
    darwin: ["Microsoft Edge"],
    linux: ["microsoft-edge"],
  },
};

function getAppDataDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || "";
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return path.join(os.homedir(), ".config");
}

export function getChromiumProfiles(browser: "chrome" | "edge"): string[] {
  try {
    const appData = getAppDataDir();
    const pathSegments = CHROMIUM_BROWSER_PATHS[browser][
      process.platform === "win32" ? "win32" :
      process.platform === "darwin" ? "darwin" : "linux"
    ];
    const dataDir = path.join(appData, ...pathSegments);

    if (!existsSync(dataDir)) {
      return [];
    }

    return readdirSync(dataDir)
      .filter(
        (item) =>
          item.startsWith("Profile") ||
          item === "Default" ||
          item === "Guest Profile",
      )
      .sort();
  } catch (error) {
    console.warn(`[${browser}] Error getting profiles:`, error);
    return [];
  }
}
