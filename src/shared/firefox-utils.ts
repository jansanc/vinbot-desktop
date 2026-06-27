import path from "path";
import os from "os";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import type { Fingerprint } from "../types";

export function parseFirefoxPrefs(profilePath: string): Record<string, any> {
  try {
    const prefsPath = path.join(profilePath, "prefs.js");
    const content = readFileSync(prefsPath, "utf-8");

    const prefs: Record<string, any> = {};
    const regex = /user_pref\("([^"]+)",\s*(.+?)\);/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const key = match[1];
      let value: any = match[2];

      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (!isNaN(Number(value))) value = Number(value);
      else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      prefs[key] = value;
    }

    return prefs;
  } catch (error) {
    console.warn("Could not read prefs.js:", error);
    return {};
  }
}

export function getFirefoxVersion(): string {
  try {
    const output = execSync("firefox --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return output.trim();
  } catch {
    return "Firefox (version unknown)";
  }
}

export function getDefaultFonts(): string[] {
  const baseFonts = [
    "Arial",
    "Helvetica",
    "Times New Roman",
    "Courier New",
    "Verdana",
    "Georgia",
    "Palatino",
    "Calibri",
    "Cambria",
    "Consolas",
  ];

  if (process.platform === "win32") {
    baseFonts.push("Segoe UI", "Tahoma", "Trebuchet MS");
  }

  return baseFonts;
}

export async function extractFingerprint(
  profilePath: string,
): Promise<Fingerprint> {
  const prefs = parseFirefoxPrefs(profilePath);
  const acceptLanguages = String(prefs["intl.accept_languages"] || "en-GB");
  const localeString = String(prefs["general.useragent.locale"] || "en-GB");

  const platform = os.platform();
  const platformString =
    platform === "win32"
      ? "Win32"
      : platform === "darwin"
        ? "MacIntel"
        : "Linux x86_64";
  const cpuCount = os.cpus().length;
  const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024));

  return {
    extractedAt: new Date().toISOString(),
    browser: "Firefox",
    source: "Extracted from Firefox profile and system settings",
    userAgent: `Mozilla/5.0 (${platformString}) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/120.0`,
    language: acceptLanguages.split(",")[0] || "en-GB",
    languages: acceptLanguages.split(",").map((l: string) => l.trim()),
    platform: platformString,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: localeString,
    screen: {
      width: 1920,
      height: 1080,
      colorDepth: 24,
    },
    hardwareConcurrency: cpuCount,
    deviceMemory: totalMem,
    installedFonts: getDefaultFonts(),
    plugins: [{ name: "PDF Viewer", description: "Portable Document Format" }],
    systemInfo: {
      platform,
      arch: os.arch(),
      firefoxVersion: getFirefoxVersion(),
    },
  };
}
