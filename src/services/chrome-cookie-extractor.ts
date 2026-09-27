/**
 * Chrome Cookie Extractor
 *
 * Reads cookies directly from Chrome's SQLite database instead of
 * archiving the entire 434MB profile. Returns storageState JSON (~8KB).
 */

import * as fs from "fs";
import * as path from "path";
import * as sqlite3 from "sqlite3";
import { StorageState, StorageStateContextConfig, CookieData } from "./storage-state.service";

export class ChromeCookieExtractor {
  /**
   * Extract cookies from Chrome profile's SQLite database
   * Finds the Cookies database file in the profile directory
   */
  static async extractCookiesFromChrome(profilePath: string): Promise<CookieData[]> {
    try {
      // Find the Cookies database - try multiple possible locations
      let cookiesDbPath: string | null = null;
      const possiblePaths = [
        path.join(profilePath, "Network", "Cookies"), // Main location (Chrome stores in Network subdir)
        path.join(profilePath, "Cookies"),           // Root of profile
        path.join(profilePath, "Default", "Network", "Cookies"), // Nested in Default/Network
        path.join(profilePath, "Default", "Cookies"), // Nested in Default
      ];

      // Check predefined paths FIRST (most reliable)
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          cookiesDbPath = possiblePath;
          console.log(`[ChromeCookieExtractor] Found Cookies database at: ${cookiesDbPath}`);
          break;
        }
      }

      // Only use file search as fallback, and be specific: match EXACTLY "Cookies" not "Extension Cookies"
      if (!cookiesDbPath && fs.existsSync(profilePath)) {
        const files = fs.readdirSync(profilePath);
        // Look for exactly "Cookies" (case-sensitive on some systems)
        const exactCookieFile = files.find(f => f === "Cookies" && !f.endsWith("-journal"));
        if (exactCookieFile) {
          cookiesDbPath = path.join(profilePath, exactCookieFile);
          console.log(`[ChromeCookieExtractor] Found Cookies file at root: ${cookiesDbPath}`);
        }
      }

      if (!cookiesDbPath || !fs.existsSync(cookiesDbPath)) {
        console.log(`[ChromeCookieExtractor] Profile path contents:`, fs.readdirSync(profilePath));
        throw new Error(`Chrome Cookies database not found at: ${profilePath}\nTried: ${possiblePaths.join(", ")}`);
      }

      // Create a temporary copy since Chrome locks the database
      const tempDbPath = path.join(
        require("os").tmpdir(),
        `chrome_cookies_${Date.now()}.db`
      );
      fs.copyFileSync(cookiesDbPath, tempDbPath);

      try {
        // Open database and query cookies
        const cookies = await new Promise<CookieData[]>((resolve, reject) => {
          const db = new sqlite3.Database(tempDbPath, (err) => {
            if (err) {
              reject(err);
              return;
            }

            // First query all cookies to see what's in the database
            db.all(
              `SELECT COUNT(*) as total FROM cookies`,
              (err, countRows: any[]) => {
                const totalCookies = countRows?.[0]?.total || 0;
                console.log(`[ChromeCookieExtractor] Total cookies in database: ${totalCookies}`);

                // Query Vinted cookies specifically
                db.all(
                  `SELECT
                    name,
                    value,
                    host_key as domain,
                    path,
                    expires_utc,
                    is_httponly,
                    is_secure,
                    samesite
                  FROM cookies
                  WHERE host_key LIKE '%vinted%'`,
                  (err, rows: any[]) => {
                    if (err) {
                      db.close();
                      reject(err);
                      return;
                    }

                    console.log(`[ChromeCookieExtractor] Vinted cookies found: ${rows.length}`);
                    if (rows.length > 0) {
                      console.log(
                        `[ChromeCookieExtractor] Vinted cookie names:`,
                        rows.map((r) => `${r.name} (domain: ${r.domain})`).join(", ")
                      );
                    } else {
                      // Debug: show all domains to understand what's in the database
                      db.all(
                        `SELECT DISTINCT host_key FROM cookies LIMIT 20`,
                        (err, domains: any[]) => {
                          if (!err && domains.length > 0) {
                            console.log(
                              `[ChromeCookieExtractor] Available domains:`,
                              domains.map((d) => d.host_key).join(", ")
                            );
                          }
                        }
                      );
                    }

                    // Convert to storageState format
                    const cookieData: CookieData[] = rows.map((row) => ({
                      name: row.name,
                      value: row.value,
                      domain: row.domain || undefined,
                      path: row.path || "/",
                      // Chrome stores expires_utc in microseconds since epoch
                      expires: row.expires_utc ? Math.floor(row.expires_utc / 1000000) : undefined,
                      httpOnly: row.is_httponly === 1,
                      secure: row.is_secure === 1,
                      sameSite: this.convertSameSite(row.samesite),
                    }));

                    // Close database with callback to ensure it's fully released
                    db.close((closeErr) => {
                      if (closeErr) {
                        console.error("[ChromeCookieExtractor] DB close error:", closeErr);
                        reject(closeErr);
                      } else {
                        resolve(cookieData);
                      }
                    });
                  }
                );
              }
            );
          });
        });

        console.log(
          `[ChromeCookieExtractor] Extracted ${cookies.length} Vinted cookies from Chrome profile`
        );

        // Log critical cookies
        const criticalCookies = cookies.filter((c) =>
          c.name.includes("token") ||
          c.name.includes("auth") ||
          c.name.includes("datadome") ||
          c.name.includes("session")
        );
        console.log(
          `[ChromeCookieExtractor] Critical cookies: ${criticalCookies.map((c) => c.name).join(", ")}`
        );

        return cookies;
      } finally {
        // Clean up temp file - with retry logic for Windows lock issues
        if (fs.existsSync(tempDbPath)) {
          try {
            fs.unlinkSync(tempDbPath);
            console.log(`[ChromeCookieExtractor] Temp DB cleaned up: ${tempDbPath}`);
          } catch (unlinkErr) {
            // Ignore unlink errors - temp file will be cleaned up by OS eventually
            console.warn(`[ChromeCookieExtractor] Could not delete temp DB (will clean up later): ${unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)}`);
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[ChromeCookieExtractor] Failed to extract cookies: ${msg}`);
      throw error;
    }
  }

  /**
   * Extract localStorage from Chrome profile
   * localStorage is stored in {Profile}/Local Storage/leveldb
   * This is more complex, so we return a basic version
   */
  static extractLocalStorageFromChrome(profilePath: string): {
    [origin: string]: { [key: string]: string };
  } {
    try {
      const localStoragePath = path.join(profilePath, "Local Storage");

      if (!fs.existsSync(localStoragePath)) {
        console.log(`[ChromeCookieExtractor] No Local Storage directory found`);
        return {};
      }

      // For now, return empty - Chrome's localStorage is in leveldb format
      // which is complex to parse. Vinted auth is cookie-based anyway.
      console.log(
        `[ChromeCookieExtractor] Note: localStorage parsing not implemented (not needed for Vinted auth)`
      );
      return {};
    } catch (error) {
      console.error(
        `[ChromeCookieExtractor] Failed to extract localStorage: ${error instanceof Error ? error.message : String(error)}`
      );
      return {};
    }
  }

  /**
   * Extract full storageState from Chrome profile
   * This replaces the need to archive 434MB - just extract 8KB JSON
   */
  static async extractStorageStateFromChrome(
    profilePath: string,
    contextConfig: Omit<StorageStateContextConfig, "capturedAt">
  ): Promise<StorageState> {
    console.log(`[ChromeCookieExtractor] Extracting storageState from Chrome profile...`);
    const startTime = Date.now();

    // Extract cookies from SQLite database
    const cookies = await this.extractCookiesFromChrome(profilePath);

    // Extract localStorage (returns {} for now - cookies are what matter)
    const localStorageMap = this.extractLocalStorageFromChrome(profilePath);

    // Convert localStorage to Playwright format
    const origins = Object.entries(localStorageMap).map(([origin, data]) => ({
      origin,
      localStorage: Object.entries(data).map(([name, value]) => ({
        name,
        value,
      })),
    }));

    const state: StorageState = {
      cookies,
      origins: origins.length > 0 ? origins : undefined,
      contextConfig: {
        ...contextConfig,
        capturedAt: Date.now(),
      },
    };

    const elapsedMs = Date.now() - startTime;
    const sizeKB = (JSON.stringify(state).length / 1024).toFixed(1);
    console.log(
      `[ChromeCookieExtractor] Extracted storageState in ${elapsedMs}ms (${sizeKB}KB)`
    );

    return state;
  }

  /**
   * Get Chrome profile path for current user
   */
  static getDefaultChromeProfilePath(): string {
    const userDataDir = process.env.LOCALAPPDATA;
    if (!userDataDir) {
      throw new Error("LOCALAPPDATA environment variable not set");
    }

    return path.join(userDataDir, "Google", "Chrome", "User Data", "Default");
  }

  /**
   * Convert Chrome's sameSite integer to standard string
   * Chrome: 0 = None, 1 = Lax, 2 = Strict
   */
  private static convertSameSite(
    value: number | undefined
  ): "Strict" | "Lax" | "None" | undefined {
    if (value === undefined || value === null) return undefined;
    switch (value) {
      case 0:
        return "None";
      case 1:
        return "Lax";
      case 2:
        return "Strict";
      default:
        return undefined;
    }
  }
}
