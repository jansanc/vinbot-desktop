import path from "path";
import os from "os";
import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync } from "fs";
import type {
  Fingerprint,
  ExtractionData,
  Cookie,
  StorageOrigin,
  LocalStorageItem,
} from "../../types";

interface SqlJsDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}

interface SqlJsStatic {
  Database: new (buffer: Buffer) => SqlJsDatabase;
}

function getVintedHostname(vintedBaseUrl: string): string {
  try {
    const url = new URL(vintedBaseUrl);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "vinted.com";
  }
}

function normalizeCookieDomain(domain: string): string {
  let normalized = domain.toLowerCase().trim();
  if (normalized.startsWith(".www.")) {
    normalized = normalized.replace(/^\.www\./, ".");
  } else if (normalized === "www.vinted.es") {
    normalized = ".vinted.es";
  }
  return normalized;
}

function isAuthRelatedStorage(key: string): boolean {
  if (key.match(/^[a-f0-9]{64,}$/) !== null) {
    return false;
  }
  const authKeywords = [
    "session",
    "token",
    "auth",
    "user",
    "refresh",
    "access",
  ];
  return authKeywords.some((k) => key.toLowerCase().includes(k));
}

function convertValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value as Record<string, unknown>);
    const allNumeric =
      keys.length > 0 && keys.every((k) => !isNaN(parseInt(k)));
    if (allNumeric) {
      const charCodes = keys
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((key) => (value as Record<string, number>)[key]);
      try {
        return String.fromCharCode(...charCodes);
      } catch {
        return JSON.stringify(value);
      }
    }
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

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

export function extractCookies(
  profilePath: string,
  SQL: SqlJsStatic,
  vintedBaseUrl: string,
): Cookie[] {
  const dbPath = path.join(profilePath, "cookies.sqlite");
  const vintedHostname = getVintedHostname(vintedBaseUrl);

  if (!existsSync(dbPath)) {
    console.warn("[Cookies] cookies.sqlite not found");
    return [];
  }

  try {
    const buffer = readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    const results = db.exec(
      "SELECT name, value, host, path, isSecure, isHttpOnly, sameSite, expiry FROM moz_cookies",
    );

    if (!results.length) {
      return [];
    }

    db.close();
    const sameSiteMap: Record<number, string> = {
      0: "None",
      1: "Lax",
      2: "Strict",
    };

    return results[0].values
      .filter(([, , host]) => {
        const hostStr = ((host as string) || "").toLowerCase();
        // Remove leading dot for comparison
        const normalizedHost = hostStr.replace(/^\./, "");
        const normalizedHostname = vintedHostname.replace(/^\./, "");

        // Match if it's an exact match or a subdomain match
        const matches =
          normalizedHost === normalizedHostname ||
          normalizedHost.endsWith("." + normalizedHostname);

        if (!matches) {
          console.log(`[Cookies] Cookie domain`, hostStr, "doesn't match", vintedHostname);
        } else {
          console.log(`[Cookies] ✓ Matched cookie domain:`, hostStr);
        }
        return matches;
      })
      .map(
        ([name, value, host, pathVal, secure, httpOnly, sameSite, expiry]) =>
          ({
            name: (name as string) || "",
            value: (value as string) || "",
            domain: normalizeCookieDomain((host as string) || ""),
            path: (pathVal as string) || "/",
            expires: expiry ? Math.floor((expiry as number) / 1000) : undefined,
            httpOnly: (httpOnly as number) === 1,
            secure: (secure as number) === 1,
            sameSite: ["Strict", "Lax", "None"].includes(sameSite as string)
              ? (sameSite as string)
              : sameSiteMap[sameSite as number] || "None",
          }) as Cookie,
      );
  } catch (error) {
    console.warn("[Cookies] Error:", error);
    return [];
  }
}

export function extractLocalStorage(
  profilePath: string,
  SQL: SqlJsStatic,
  vintedBaseUrl: string,
): StorageOrigin[] {
  const storageDir = path.join(profilePath, "storage", "default");
  const origins: StorageOrigin[] = [];
  const vintedHostname = getVintedHostname(vintedBaseUrl);

  if (!existsSync(storageDir)) {
    return [];
  }

  try {
    readdirSync(storageDir).forEach((encodedOrigin) => {
      const origin = encodedOrigin.replace(/\+{3}/g, "://").replace(/\^/g, ":");

      const originHostname = new URL(origin).hostname.replace(/^www\./, "");
      const normalizedOriginHostname = originHostname.replace(/^\./, "");
      const normalizedVintedHostname = vintedHostname.replace(/^\./, "");

      const matches =
        normalizedOriginHostname === normalizedVintedHostname ||
        normalizedOriginHostname.endsWith("." + normalizedVintedHostname);

      if (!matches) {
        return;
      }

      const dbPath = path.join(storageDir, encodedOrigin, "ls", "data.sqlite");

      if (existsSync(dbPath)) {
        try {
          const buffer = readFileSync(dbPath);
          const db = new SQL.Database(buffer);
          const results = db.exec("SELECT key, value FROM data");
          db.close();

          if (results.length && results[0].values.length > 0) {
            const localStorage: LocalStorageItem[] = results[0].values
              .filter(([key]) => isAuthRelatedStorage(key as string))
              .map(([key, value]) => ({
                name: key as string,
                value: convertValue(value),
              }));

            if (localStorage.length > 0) {
              origins.push({
                origin,
                localStorage,
              });
            }
          }
        } catch (e) {
          console.warn(`[LocalStorage] Error reading ${encodedOrigin}:`, e);
        }
      }
    });
  } catch (error) {
    console.warn("[LocalStorage] Error:", error);
  }

  return origins;
}

export function extractSessionStorage(
  profilePath: string,
  SQL: SqlJsStatic,
  vintedBaseUrl: string,
): StorageOrigin[] {
  const storageDir = path.join(profilePath, "storage", "default");
  const origins: StorageOrigin[] = [];
  const vintedHostname = getVintedHostname(vintedBaseUrl);

  if (!existsSync(storageDir)) {
    return [];
  }

  try {
    readdirSync(storageDir).forEach((encodedOrigin) => {
      const origin = encodedOrigin.replace(/\+{3}/g, "://").replace(/\^/g, ":");

      if (!origin.includes(vintedHostname)) {
        return;
      }

      const dbPath = path.join(storageDir, encodedOrigin, "ss", "data.sqlite");

      if (existsSync(dbPath)) {
        try {
          const buffer = readFileSync(dbPath);
          const db = new SQL.Database(buffer);
          const results = db.exec("SELECT key, value FROM data");
          db.close();

          if (results.length && results[0].values.length > 0) {
            const sessionStorage: LocalStorageItem[] = results[0].values.map(
              ([key, value]) => ({
                name: key as string,
                value: convertValue(value),
              }),
            );

            origins.push({
              origin,
              sessionStorage,
            });
          }
        } catch (e) {
          console.warn(
            `[SessionStorage] Error reading ${encodedOrigin}:`,
            e,
          );
        }
      }
    });
  } catch (error) {
    console.warn("[SessionStorage] Error:", error);
  }

  return origins;
}

export async function extractFirefoxProfileData(
  profilePath: string,
  vintedBaseUrl: string = "https://www.vinted.com",
): Promise<ExtractionData> {
  try {
    console.log("[Firefox] Extracting from:", profilePath);

    // Extract fingerprint
    const fingerprint = await extractFingerprint(profilePath);

    // Initialize SQL.js
    const initSqlJs = require("sql.js");
    const SQL: SqlJsStatic = await initSqlJs();

    // Extract cookies
    const cookies = extractCookies(profilePath, SQL, vintedBaseUrl);
    console.log(`[Firefox] Extracted ${cookies.length} cookies`);

    // Extract localStorage
    let origins = extractLocalStorage(profilePath, SQL, vintedBaseUrl);
    console.log(`[Firefox] Extracted ${origins.length} localStorage origins`);

    origins.forEach((origin) => {
      origin.localStorage?.forEach((item) => {
        if (typeof item.value !== "string") {
          item.value = convertValue(item.value);
        }
      });
    });

    // Extract sessionStorage
    const sessionOrigins = extractSessionStorage(
      profilePath,
      SQL,
      vintedBaseUrl,
    );
    console.log(`[Firefox] Extracted ${sessionOrigins.length} sessionStorage origins`);

    sessionOrigins.forEach((sOrigin) => {
      const existing = origins.find((o) => o.origin === sOrigin.origin);
      if (existing) {
        existing.sessionStorage = sOrigin.sessionStorage;
      } else {
        origins.push(sOrigin);
      }
    });

    console.log(`[Firefox] Complete: ${cookies.length} cookies, ${origins.length} origins`);

    return {
      fingerprint,
      authentication: {
        cookies,
        origins,
      },
    };
  } catch (error) {
    console.error("[Firefox] Extraction error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract Firefox profile data: ${errorMessage}`);
  }
}
