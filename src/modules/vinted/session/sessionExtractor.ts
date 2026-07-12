import path from "path";
import os from "os";
import { existsSync, readFileSync } from "fs";

// Dynamically import sqlite3 only in main process
let sqlite3: any = null;
try {
  sqlite3 = require("sqlite3");
} catch (error) {
  console.warn("[SessionExtractor] sqlite3 not available, session extraction disabled");
}

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly?: boolean;
  expires?: number;
}

export interface SessionStorage {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface ExtractedSession {
  profile_name: string;
  profile_path: string;
  url: string;
  cookies: SessionCookie[];
  storage: SessionStorage;
  user_agent?: string;
  extracted_at: number;
}

export class SessionExtractor {
  private appData = process.env.APPDATA || "";
  private programFiles = process.env.ProgramFiles || "C:\\Program Files";
  private programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  /**
   * Extract cookies from Chrome profile's SQLite database
   */
  async extractChromeCookies(profilePath: string, domain: string): Promise<SessionCookie[]> {
    if (!sqlite3) {
      console.warn(`[Chrome] sqlite3 not available`);
      return [];
    }

    const cookiesDb = path.join(profilePath, "Cookies");

    if (!existsSync(cookiesDb)) {
      console.warn(`[Chrome] Cookies DB not found at ${cookiesDb}`);
      return [];
    }

    return new Promise((resolve) => {
      // SQLite3 needs to be opened in read-only mode to avoid file locks
      const db = new sqlite3.Database(`file:${cookiesDb}?mode=ro`, sqlite3.OPEN_READONLY, (err: any) => {
        if (err) {
          console.warn(`[Chrome] Failed to open Cookies DB: ${err?.message || String(err)}`);
          resolve([]);
          return;
        }

        const query = domain
          ? `SELECT name, value, host_key, path, secure, expires_utc FROM cookies WHERE host_key LIKE ?`
          : `SELECT name, value, host_key, path, secure, expires_utc FROM cookies`;

        const params = domain ? [`%${domain}%`] : [];

        db.all(query, params, (err: any, rows: any[]) => {
          db.close(() => {
            if (err) {
              console.warn(`[Chrome] Query failed: ${err?.message || String(err)}`);
              resolve([]);
              return;
            }

            const cookies: SessionCookie[] = (rows || []).map((row: any) => ({
              name: row.name,
              value: row.value,
              domain: row.host_key,
              path: row.path,
              secure: row.secure === 1,
              expires: row.expires_utc ? Math.floor(row.expires_utc / 1000000) : undefined,
            }));

            resolve(cookies);
          });
        });
      });
    });
  }

  /**
   * Extract cookies from Firefox profile's SQLite database
   */
  async extractFirefoxCookies(profilePath: string, domain: string): Promise<SessionCookie[]> {
    if (!sqlite3) {
      console.warn(`[Firefox] sqlite3 not available`);
      return [];
    }

    const cookiesDb = path.join(profilePath, "cookies.sqlite");

    if (!existsSync(cookiesDb)) {
      console.warn(`[Firefox] Cookies DB not found at ${cookiesDb}`);
      return [];
    }

    return new Promise((resolve) => {
      const db = new sqlite3.Database(`file:${cookiesDb}?mode=ro`, sqlite3.OPEN_READONLY, (err: any) => {
        if (err) {
          console.warn(`[Firefox] Failed to open Cookies DB: ${err?.message || String(err)}`);
          resolve([]);
          return;
        }

        const query = domain
          ? `SELECT name, value, host, path, isSecure, expiry FROM moz_cookies WHERE host LIKE ?`
          : `SELECT name, value, host, path, isSecure, expiry FROM moz_cookies`;

        const params = domain ? [`%${domain}%`] : [];

        db.all(query, params, (err: any, rows: any[]) => {
          db.close(() => {
            if (err) {
              console.warn(`[Firefox] Query failed: ${err?.message || String(err)}`);
              resolve([]);
              return;
            }

            const cookies: SessionCookie[] = (rows || []).map((row: any) => ({
              name: row.name,
              value: row.value,
              domain: row.host,
              path: row.path,
              secure: row.isSecure === 1,
              expires: row.expiry,
            }));

            resolve(cookies);
          });
        });
      });
    });
  }

  /**
   * Extract localStorage and sessionStorage from browser profile
   * Note: These are stored in IndexedDB/LevelDB for Chrome/Chromium browsers
   * For now, return empty as we focus on cookies which are the most critical
   */
  async extractStorage(profilePath: string): Promise<SessionStorage> {
    return {
      localStorage: {},
      sessionStorage: {},
    };
  }

  /**
   * Extract complete session from a browser profile
   */
  async extractSession(
    browser: "chrome" | "firefox" | "edge",
    profileId: string,
    domain: string = ".vinted.com"
  ): Promise<ExtractedSession> {
    let profilePath = "";

    if (browser === "chrome") {
      const userDataDir = path.join(this.appData, "Google", "Chrome", "User Data");
      profilePath = path.join(userDataDir, profileId);
    } else if (browser === "firefox") {
      const firefoxDir = path.join(this.appData, "Mozilla\\Firefox\\Profiles");
      profilePath = path.join(firefoxDir, profileId);
    } else if (browser === "edge") {
      const userDataDir = path.join(this.appData, "Microsoft", "Edge", "User Data");
      profilePath = path.join(userDataDir, profileId);
    }

    if (!existsSync(profilePath)) {
      throw new Error(`Profile path not found: ${profilePath}`);
    }

    console.log(`[SessionExtractor] Extracting session from ${browser} profile: ${profilePath}`);

    let cookies: SessionCookie[] = [];

    if (browser === "chrome" || browser === "edge") {
      cookies = await this.extractChromeCookies(profilePath, domain);
    } else if (browser === "firefox") {
      cookies = await this.extractFirefoxCookies(profilePath, domain);
    }

    const storage = await this.extractStorage(profilePath);

    return {
      profile_name: profileId,
      profile_path: profilePath,
      url: `https://${domain.replace(/^\\./, "")}`,
      cookies,
      storage,
      extracted_at: Date.now(),
    };
  }
}
