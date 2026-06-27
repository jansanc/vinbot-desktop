#!/usr/bin/env node

// Load environment variables early - must be before any other imports
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import readline from "readline";
import { writeFileSync, mkdirSync, existsSync } from "fs";

import {
  getFirefoxProfilesDir,
  listFirefoxProfiles,
} from "../src/shared/browser-profiles";
import { extractFingerprint } from "../src/shared/firefox-utils";
import { convertValue, getErrorMessage } from "../src/shared/vinted-utils";
import type { SqlJsStatic } from "../src/shared/sql-types";
import type { Cookie, StorageOrigin } from "../src/types";
import {
  extractCookies,
  extractLocalStorage,
  extractSessionStorage,
} from "../src/shared/storage-extraction";

// Setup paths and load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..", "..");
const envPath = path.join(projectRoot, ".env");
dotenv.config({ path: envPath });

const require = createRequire(import.meta.url);

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
 *   npx ts-node src/cli/extract-vinted-firefox.ts
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
  const firefoxProfilesDir = getFirefoxProfilesDir();

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
    const profileDirs = listFirefoxProfiles();

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
      `Could not find Firefox profile: ${getErrorMessage(error)}`,
    );
  }
}

// ============================================================================
// AUTHENTICATION EXTRACTION
// ============================================================================

async function extractAuthentication(
  profilePath: string,
): Promise<{ cookies: Cookie[]; origins: StorageOrigin[] }> {
  logger.info("\n🔐 Extracting authentication session...");

  try {
    const initSqlJs = require("sql.js");
    const SQL: SqlJsStatic = await initSqlJs();

    logger.info("   Reading cookies...");
    const cookies = extractCookies(profilePath, SQL, VINTED_BASE_URL);
    logger.info(`   ✓ ${cookies.length} cookies found`);

    logger.info("   Reading localStorage...");
    let origins = extractLocalStorage(profilePath, SQL, VINTED_BASE_URL);
    logger.info(`   ✓ ${origins.length} origins found`);

    origins.forEach((origin) => {
      origin.localStorage?.forEach((item) => {
        if (typeof item.value !== "string") {
          item.value = convertValue(item.value);
        }
      });
    });

    logger.info("   Reading sessionStorage...");
    const sessionOrigins = extractSessionStorage(profilePath, SQL, VINTED_BASE_URL);
    sessionOrigins.forEach((sOrigin) => {
      const existing = origins.find((o) => o.origin === sOrigin.origin);
      if (existing) {
        existing.sessionStorage = sOrigin.sessionStorage;
      } else {
        origins.push(sOrigin);
      }
    });
    logger.info("   ✓ sessionStorage processed");

    return { cookies, origins };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND"
    ) {
      logger.error("Install sql.js first: npm install sql.js");
    } else {
      logger.error(`Error: ${getErrorMessage(error)}`);
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
    logger.info("\n📊 Extracting browser fingerprint...");
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
          "../src/modules/vinted/auth/vintedAuth.service.ts"
        );
        await saveFirefoxExtractionData(vintedEmail, fingerprint, auth, userEmail, vintedMemberId);
        logger.success(`   ✓ Fingerprint stored (${Object.keys(fingerprint).length} properties)`);
        logger.success(`   ✓ Cookies stored (${auth.cookies.length} total)`);
        logger.success(`   ✓ Origins stored (${auth.origins.length} total)`);
      } catch (dbError) {
        logger.error(
          `   ❌ Could not save to database: ${getErrorMessage(dbError)}`,
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
          `   ❌ Could not save to file: ${getErrorMessage(fileError)}`,
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
      `Unhandled error: ${getErrorMessage(error)}`,
    );
    process.exit(1);
  }
}

// Run extraction
extractAll();
