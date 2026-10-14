#!/usr/bin/env node

// Load environment variables early - must be before any other imports
import * as dotenv from "dotenv";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import readline from "readline";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "fs";

// Setup paths and load env (this file lives in <project>/cli)
const projectRoot = path.join(__dirname, "..");
const envPath = path.join(projectRoot, ".env");
dotenv.config({ path: envPath });

/**
 * Firefox extraction script for Vinted automation
 *
 * Extracts:
 * 1. Browser fingerprint (userAgent, timezone, locale, screen, hardware)
 * 2. Authentication session data (cookies, localStorage, sessionStorage)
 *
 * From your Firefox profile and stores in:
 * - vinted_accounts table in Supabase
 *
 * Usage:
 *   npm run extract:vinted:firefox
 *   or
 *   npx ts-node cli/vinted-firefox.ts
 *
 * No need to launch Firefox - reads directly from profile directory.
 */

// Logger
const logger = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
};

const VINTED_BASE_URL = process.env.VINTED_BASE_URL || "https://www.vinted.com";

// ============================================================================
// FIREFOX PROFILE DISCOVERY
// ============================================================================

function findFirefoxProfile(): string {
  const appData = process.env.APPDATA || "";
  const firefoxProfilesDir = path.join(appData, "Mozilla\\Firefox\\Profiles");

  // Allow override via env variable or command line arg
  if (process.env.FIREFOX_PROFILE) {
    const overridePath = path.join(firefoxProfilesDir, process.env.FIREFOX_PROFILE);
    if (existsSync(overridePath)) {
      logger.info(`Using Firefox profile from FIREFOX_PROFILE env: ${process.env.FIREFOX_PROFILE}`);
      return overridePath;
    } else {
      logger.warn(`FIREFOX_PROFILE specified but not found: ${process.env.FIREFOX_PROFILE}`);
    }
  }

  try {
    const profiles = readdirSync(firefoxProfilesDir);
    const profileDirs = profiles.filter(
      (f: string) => f.includes(".") || f.includes(" "),
    );

    if (profileDirs.length === 0) {
      throw new Error("No Firefox profiles found");
    }

    // List all available profiles for user awareness
    logger.info(`Found ${profileDirs.length} Firefox profile(s):`);
    profileDirs.forEach((profile, index) => {
      logger.info(`  ${index + 1}. ${profile}`);
    });

    // Use the first profile, but mention which one
    const selectedProfile = profileDirs[0];
    const profilePath = path.join(firefoxProfilesDir, selectedProfile);
    logger.info(`\n✓ Using profile: ${selectedProfile}`);
    logger.info(`📁 Path: ${profilePath}`);
    logger.info(`\nℹ️  To use a different profile, set: FIREFOX_PROFILE=<profile-name> npm run extract:vinted:firefox`);

    return profilePath;
  } catch (error) {
    throw new Error(
      `Could not find Firefox profile: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ============================================================================
// FINGERPRINT EXTRACTION
// ============================================================================

function parseFirefoxPrefs(profilePath: string): Record<string, any> {
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
    logger.warn(
      `Could not read prefs.js: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return {};
  }
}

function getFirefoxVersion(): string {
  try {
    // Suppress stderr on Windows since Firefox might not be in PATH
    const output = execSync("firefox --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"], // Suppress stderr
    });
    return output.trim();
  } catch {
    return "Firefox (version unknown)";
  }
}

function getDefaultFonts(): string[] {
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

async function extractFingerprint(profilePath: string) {
  logger.info("\n📊 Extracting browser fingerprint...");

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

  const fingerprint = {
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
    plugins: [
      { name: "PDF Viewer", description: "Portable Document Format" },
    ],
    systemInfo: {
      platform,
      arch: os.arch(),
      firefoxVersion: getFirefoxVersion(),
    },
  };

  return fingerprint;
}

// ============================================================================
// AUTHENTICATION EXTRACTION
// ============================================================================

interface SqlJsDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}

interface SqlJsStatic {
  Database: new (buffer: Buffer) => SqlJsDatabase;
}

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface LocalStorageItem {
  name: string;
  value: string;
}

interface StorageOrigin {
  origin: string;
  localStorage?: LocalStorageItem[];
  sessionStorage?: LocalStorageItem[];
}

interface VintedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface VintedOrigin {
  origin: string;
  localStorage?: LocalStorageItem[];
  sessionStorage?: LocalStorageItem[];
}

function getVintedHostname(): string {
  try {
    const url = new URL(VINTED_BASE_URL);
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

function extractCookies(profilePath: string, SQL: SqlJsStatic): VintedCookie[] {
  const dbPath = path.join(profilePath, "cookies.sqlite");
  const vintedHostname = getVintedHostname();

  if (!existsSync(dbPath)) {
    logger.warn("   cookies.sqlite not found");
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
    const sameSiteMap: Record<number, string> = { 0: "None", 1: "Lax", 2: "Strict" };

    return results[0].values
      .filter(([, , host]) => {
        const hostStr = (host as string || "").toLowerCase();
        return hostStr.includes(vintedHostname);
      })
      .map(
        ([name, value, host, pathVal, secure, httpOnly, sameSite, expiry]) => ({
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
        } as VintedCookie),
      );
  } catch (error) {
    logger.warn(
      `   Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function extractLocalStorage(profilePath: string, SQL: SqlJsStatic): StorageOrigin[] {
  const storageDir = path.join(profilePath, "storage", "default");
  const origins: StorageOrigin[] = [];
  const vintedHostname = getVintedHostname();

  if (!existsSync(storageDir)) {
    return [];
  }

  try {
    readdirSync(storageDir).forEach((encodedOrigin) => {
      const origin = encodedOrigin.replace(/\+{3}/g, "://").replace(/\^/g, ":");

      if (!origin.includes(vintedHostname)) {
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
          logger.warn(
            `   Error reading ${encodedOrigin}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    });
  } catch (error) {
    logger.warn(
      `   Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return origins;
}

function extractSessionStorage(profilePath: string, SQL: SqlJsStatic): StorageOrigin[] {
  const storageDir = path.join(profilePath, "storage", "default");
  const origins: StorageOrigin[] = [];
  const vintedHostname = getVintedHostname();

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
          logger.warn(
            `   Error reading sessionStorage ${encodedOrigin}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    });
  } catch (error) {
    logger.warn(
      `   Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return origins;
}

async function extractAuthentication(
  profilePath: string,
): Promise<{ cookies: VintedCookie[]; origins: VintedOrigin[] }> {
  logger.info("\n🔐 Extracting authentication session...");

  try {
    const initSqlJs = require("sql.js");
    const SQL: SqlJsStatic = await initSqlJs();

    logger.info("   Reading cookies...");
    const cookies = extractCookies(profilePath, SQL);
    logger.info(`   ✓ ${cookies.length} cookies found`);

    logger.info("   Reading localStorage...");
    let origins = extractLocalStorage(profilePath, SQL);
    logger.info(`   ✓ ${origins.length} origins found`);

    origins.forEach((origin) => {
      origin.localStorage?.forEach((item) => {
        if (typeof item.value !== "string") {
          item.value = convertValue(item.value);
        }
      });
    });

    logger.info("   Reading sessionStorage...");
    const sessionOrigins = extractSessionStorage(profilePath, SQL);
    sessionOrigins.forEach((sOrigin) => {
      const existing = origins.find((o) => o.origin === sOrigin.origin);
      if (existing) {
        existing.sessionStorage = sOrigin.sessionStorage;
      } else {
        origins.push(sOrigin);
      }
    });
    logger.info("   ✓ sessionStorage processed");

    const storageState: { cookies: VintedCookie[]; origins: VintedOrigin[] } = {
      cookies,
      origins: origins as VintedOrigin[],
    };

    return storageState;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "MODULE_NOT_FOUND"
    ) {
      logger.error("Install sql.js first: npm install sql.js");
    } else {
      logger.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    // Check if stdin is a TTY (interactive terminal)
    if (!process.stdin.isTTY) {
      // Non-interactive mode: return empty string to use defaults
      resolve("");
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ============================================================================
// MAIN EXTRACTION FLOW
// ============================================================================

async function extractAll() {
  logger.info("🔍 Starting unified Firefox extraction for Vinted...\n");

  try {
    // Find profile
    logger.info("📂 Locating Firefox profile...");
    const profilePath = findFirefoxProfile();

    // Extract fingerprint
    const fingerprint = await extractFingerprint(profilePath);

    // Extract authentication
    const auth = await extractAuthentication(profilePath);

    // Display results
    logger.info("\n" + "=".repeat(70));
    logger.success("EXTRACTION COMPLETE!\n");

    logger.info("📊 Browser Fingerprint:");
    logger.info(`   Browser: ${fingerprint.browser}`);
    logger.info(`   Platform: ${fingerprint.platform}`);
    logger.info(`   Timezone: ${fingerprint.timezone}`);
    logger.info(`   Locale: ${fingerprint.locale}`);
    logger.info(`   Screen: ${fingerprint.screen.width}x${fingerprint.screen.height}`);
    logger.info(`   Hardware: ${fingerprint.hardwareConcurrency} cores, ${fingerprint.deviceMemory}GB RAM`);

    logger.info("\n🔐 Authentication Session:");
    logger.info(`   Cookies: ${auth.cookies.length}`);
    logger.info(`   Storage origins: ${auth.origins.length}`);
    const totalStorage = auth.origins.reduce(
      (sum, o) => sum + (o.localStorage?.length || 0) + (o.sessionStorage?.length || 0),
      0,
    );
    logger.info(`   Storage items: ${totalStorage}`);

    // Offer to save data
    logger.info("\n💾 Save Extraction Data:");
    let saveToDb = false;
    let saveToFile = false;
    let vintedEmail = "";
    let userEmail = "";

    if (process.stdin.isTTY) {
      const saveMethod = await promptUser(
        "   Save method? (1: Database, 2: Local file, 3: Both, 4: Skip): ",
      );

      const choice = saveMethod.toLowerCase().trim();
      if (choice === "1" || choice === "3") {
        saveToDb = true;
      }
      if (choice === "2" || choice === "3") {
        saveToFile = true;
      }
      if (choice === "4" || !choice) {
        logger.info(
          "\n💡 To save automatically in future runs:\n   Database: VINTED_EXTRACT_EMAIL=email@vinted.com VINTED_USER_EMAIL=user@auth.com VINTED_MEMBER_ID=your_member_id npm run extract:vinted:firefox\n   File: SAVE_EXTRACTION_FILE=true npm run extract:vinted:firefox",
        );
        logger.info("\n" + "=".repeat(70));
        return;
      }

      if (saveToDb) {
        vintedEmail = await promptUser(
          "   Enter Vinted email to associate with this extraction: ",
        );
        userEmail = await promptUser(
          "   Enter Supabase Auth user email: ",
        );
        logger.info(
          "   ℹ️  Your Vinted member ID is in your profile URL (vinted.com/member/YOUR_ID)",
        );
      }
    } else {
      // Non-interactive mode: check environment variables
      if (process.env.VINTED_EXTRACT_EMAIL && process.env.VINTED_USER_EMAIL) {
        saveToDb = true;
        vintedEmail = process.env.VINTED_EXTRACT_EMAIL;
        userEmail = process.env.VINTED_USER_EMAIL;
      }
      if (process.env.SAVE_EXTRACTION_FILE === "true") {
        saveToFile = true;
      }
    }

    // Save to database if requested
    if (saveToDb && vintedEmail && userEmail) {
      try {
        logger.info(
          `\n   📤 Saving to database for ${vintedEmail} (linking to user: ${userEmail})...`,
        );
        logger.info(
          `   📋 Data to save: fingerprint (${Object.keys(fingerprint).length} fields), ${auth.cookies.length} cookies, ${auth.origins.length} origins`,
        );

        // Get Vinted member ID from environment or prompt user
        let vintedMemberId = process.env.VINTED_MEMBER_ID || "";
        if (!vintedMemberId && process.stdin.isTTY) {
          vintedMemberId = await promptUser(
            `   Enter your Vinted member ID (found in profile URL like vinted.com/member/3160974572): `,
          );
        }

        // Dynamically import to avoid loading config at startup
        const { saveFirefoxExtractionData } = await import(
          "../src/modules/vinted/auth/vintedAuth.service"
        );
        await saveFirefoxExtractionData(vintedEmail, fingerprint, auth, userEmail, vintedMemberId);
        logger.success(`   ✓ Fingerprint stored (${Object.keys(fingerprint).length} properties)`);
        logger.success(`   ✓ Cookies stored (${auth.cookies.length} total)`);
        logger.success(`   ✓ Origins stored (${auth.origins.length} total)`);
      } catch (dbError) {
        logger.error(
          `   ❌ Could not save to database: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        );
      }
    }

    // Save to local JSON file if requested
    if (saveToFile) {
      try {
        const authDir = path.join(projectRoot, "src", "modules", "vinted", "auth");
        mkdirSync(authDir, { recursive: true });

        // Save fingerprint to separate file
        const fingerprintFilePath = path.join(authDir, "fingerprint.json");
        const fingerprintData = {
          ...fingerprint,
          extractedAt: new Date().toISOString(),
        };
        writeFileSync(fingerprintFilePath, JSON.stringify(fingerprintData, null, 2));
        logger.success(`   ✓ Fingerprint saved to ${fingerprintFilePath}`);

        // Save auth data to separate file
        const authFilePath = path.join(authDir, "auth-vinted.json");
        const storageState = {
          cookies: auth.cookies,
          origins: auth.origins,
          extractedAt: new Date().toISOString(),
        };
        writeFileSync(authFilePath, JSON.stringify(storageState, null, 2));
        logger.success(`   ✓ Auth data saved to ${authFilePath}`);

        logger.info(
          `   📂 Fingerprint file size: ${(JSON.stringify(fingerprintData).length / 1024).toFixed(2)} KB`,
        );
        logger.info(
          `   📂 Auth file size: ${(JSON.stringify(storageState).length / 1024).toFixed(2)} KB`,
        );
      } catch (fileError) {
        logger.error(
          `   ❌ Could not save to file: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
        );
      }
    }

    if (saveToDb) {
      logger.info("\n💡 Data stored in Supabase vinted_accounts table:");
      logger.info("   ✓ Browser fingerprint (firefox_fingerprint field)");
      logger.info("   ✓ Session cookies (session_data field)");
      logger.info("   ✓ Storage items (session_origins field)");
      logger.info("   ✓ Cookie string (session_cookie field)");
    }

    if (saveToFile) {
      logger.info("\n💡 Data stored in local JSON files:");
      logger.info("\n   📄 fingerprint.json (src/modules/vinted/auth/):");
      logger.info("      ✓ Browser fingerprint with all properties");
      logger.info("      ✓ Extraction timestamp");
      logger.info("\n   📄 auth-vinted.json (src/modules/vinted/auth/):");
      logger.info("      ✓ Session cookies");
      logger.info("      ✓ Storage items (origins with localStorage/sessionStorage)");
      logger.info("      ✓ Extraction timestamp");
    }

    logger.info("\n" + "=".repeat(70));
  } catch (error) {
    logger.error(
      `Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

// Run extraction
extractAll();



