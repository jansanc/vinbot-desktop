import path from "path";
import os from "os";
import { existsSync, readdirSync, readFileSync, copyFileSync, openSync, readSync, closeSync } from "fs";
import { mkdtempSync, rmSync } from "fs";
import { execSync } from "child_process";
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

function closeProcessIfRunning(exeName: string): boolean {
  try {
    if (process.platform === "win32") {
      console.log(`[CloseProcess] Attempting to close ${exeName}...`);
      execSync(`taskkill /IM ${exeName} /F`, { stdio: "pipe", windowsHide: true });
      console.log(`[CloseProcess] Successfully closed ${exeName}`);
      return true;
    }
  } catch {
    // Process not running or taskkill failed
  }
  return false;
}

function readLockedFile(filePath: string, browserType: "chrome" | "edge" = "chrome"): Buffer {
  // Try to read a locked file using lower-level APIs
  // This works by reading chunks of the file which can sometimes succeed even if the file is locked
  const maxRetries = 20;
  const retryDelay = 500; // ms
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Get file size first
      let fd: number | null = null;
      try {
        fd = openSync(filePath, "r");
        const stats = { size: 0 };
        const buffer = Buffer.alloc(4);
        const bytesRead = readSync(fd, buffer, 0, 4, 0);
        if (bytesRead === 0) {
          throw new Error("File is empty or not readable");
        }

        // File is readable, now read the entire content
        closeSync(fd);
        return readFileSync(filePath);
      } finally {
        if (fd !== null) {
          try {
            closeSync(fd);
          } catch {
            // Ignore close errors
          }
        }
      }
    } catch (error) {
      lastError = error as Error;
      const errno = (error as NodeJS.ErrnoException).code;

      if ((errno === "EBUSY" || errno === "EACCES") && attempt < maxRetries) {
        // On certain attempts, try to close the browser process
        if (attempt === 3) {
          const exeName = browserType === "edge" ? "msedge.exe" : "chrome.exe";
          console.log(`[ReadLockedFile] Attempt ${attempt}: Trying to close ${exeName}...`);
          closeProcessIfRunning(exeName);
        }

        // Exponential backoff
        const waitTime = Math.min(retryDelay * Math.pow(1.5, attempt), 10000);
        if (attempt % 5 === 0) {
          // Log every 5 attempts to avoid spam
          console.log(`[ReadLockedFile] Still retrying... (attempt ${attempt}/${maxRetries})`);
        }

        // Wait before retrying
        const before = Date.now();
        while (Date.now() - before < waitTime) {
          // Busy wait
        }
      }
    }
  }

  if (lastError) {
    throw new Error(
      `Failed to read locked file after ${maxRetries} attempts: ${lastError.message}`
    );
  }

  throw new Error("Unexpected error reading locked file");
}

function copyFileSafe(src: string, dest: string): void {
  // On Windows, try PowerShell Copy-Item (handles locked files better)
  if (process.platform === "win32") {
    try {
      // Use PowerShell to copy the file, which can handle locked files better
      const escapedSrc = src.replace(/"/g, '`"');
      const escapedDest = dest.replace(/"/g, '`"');
      execSync(
        `powershell -NoProfile -Command "Copy-Item -Path \\"${escapedSrc}\\" -Destination \\"${escapedDest}\\" -Force"`,
        {
          stdio: "pipe",
          windowsHide: true,
          timeout: 5000,
        }
      );
      return;
    } catch (error) {
      // PowerShell copy failed, fall through to copyFileSync
      console.log(
        "[CopyFile] PowerShell copy failed, falling back to native copy:",
        (error as Error).message
      );
    }
  }

  // Fallback to native copy
  copyFileSync(src, dest);
}

function getVintedHostname(vintedBaseUrl: string, browserType: "chrome" | "edge" = "chrome"): string {
  try {
    const url = new URL(vintedBaseUrl);
    const hostname = url.hostname.replace(/^www\./, "");
    const label = browserType === "edge" ? "[Edge]" : "[Chrome]";
    console.log(`${label} Extracted hostname from`, vintedBaseUrl, "->", hostname);
    return hostname;
  } catch (e) {
    const label = browserType === "edge" ? "[Edge]" : "[Chrome]";
    console.warn(`${label} Failed to parse URL:`, vintedBaseUrl, e);
    return "vinted.com";
  }
}

function normalizeCookieDomain(domain: string): string {
  let normalized = domain.toLowerCase().trim();
  if (normalized.startsWith(".")) {
    return normalized;
  }
  if (normalized.includes("vinted")) {
    return "." + normalized;
  }
  return normalized;
}

export function getChromeProfiles(): string[] {
  try {
    let chromeDataDir: string;

    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA;
      if (!localAppData) {
        console.warn("[Chrome] LOCALAPPDATA environment variable not set");
        return [];
      }
      chromeDataDir = path.join(localAppData, "Google", "Chrome", "User Data");
    } else if (process.platform === "darwin") {
      const appSupport = path.join(os.homedir(), "Library", "Application Support");
      chromeDataDir = path.join(appSupport, "Google", "Chrome");
    } else {
      chromeDataDir = path.join(os.homedir(), ".config", "google-chrome");
    }

    console.log("[Chrome] Looking for profiles in:", chromeDataDir);

    if (!existsSync(chromeDataDir)) {
      console.warn("[Chrome] Chrome data directory not found at:", chromeDataDir);
      return [];
    }

    const items = readdirSync(chromeDataDir);
    const profiles = items
      .filter(
        (item) =>
          item.startsWith("Profile") ||
          item === "Default" ||
          item === "Guest Profile",
      )
      .sort();

    console.log("[Chrome] Found profiles:", profiles);
    return profiles;
  } catch (error) {
    console.warn("[Chrome] Error getting profiles:", error);
    return [];
  }
}

function getChromeDataDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    return path.join(localAppData, "Google", "Chrome", "User Data");
  } else if (process.platform === "darwin") {
    const appSupport = path.join(os.homedir(), "Library", "Application Support");
    return path.join(appSupport, "Google", "Chrome");
  } else {
    return path.join(os.homedir(), ".config", "google-chrome");
  }
}

function getEdgeDataDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    return path.join(localAppData, "Microsoft", "Edge", "User Data");
  } else if (process.platform === "darwin") {
    const appSupport = path.join(os.homedir(), "Library", "Application Support");
    return path.join(appSupport, "Microsoft Edge");
  } else {
    return path.join(os.homedir(), ".config", "microsoft-edge");
  }
}

async function extractChromiumFingerprint(
  browserType: "chrome" | "edge" = "chrome",
): Promise<Fingerprint> {
  const platform = os.platform();
  const platformString =
    platform === "win32"
      ? "Win32"
      : platform === "darwin"
        ? "MacIntel"
        : "Linux x86_64";
  const cpuCount = os.cpus().length;
  const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024));

  const browserName = browserType === "chrome" ? "Chrome" : "Edge";
  const userAgentString =
    browserType === "chrome"
      ? `Mozilla/5.0 (${platformString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
      : `Mozilla/5.0 (${platformString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0`;
  const pluginName = browserType === "chrome" ? "Chrome PDF Plugin" : "Edge PDF Plugin";

  return {
    extractedAt: new Date().toISOString(),
    browser: browserName,
    source: `Extracted from ${browserName} profile and system settings`,
    userAgent: userAgentString,
    language: "en-US",
    languages: ["en-US", "en"],
    platform: platformString,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: "en-US",
    screen: {
      width: 1920,
      height: 1080,
      colorDepth: 24,
    },
    hardwareConcurrency: cpuCount,
    deviceMemory: totalMem,
    installedFonts: getDefaultFonts(),
    plugins: [{ name: pluginName, description: "Portable Document Format" }],
    systemInfo: {
      platform,
      arch: os.arch(),
      chromiumVersion: `${browserName} 120.0.0.0`,
    },
  };
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

export function extractChromeCookies(
  profilePath: string,
  SQL: SqlJsStatic,
  vintedBaseUrl: string,
  browserType: "chrome" | "edge" = "chrome",
): Cookie[] {
  const vintedHostname = getVintedHostname(vintedBaseUrl, browserType);
  const browserLabel = browserType.toUpperCase();

  // Modern Chrome/Edge (90+) stores cookies in Network/Cookies
  let dbPath = path.join(profilePath, "Network", "Cookies");

  console.log(`[${browserLabel} Cookies] Looking for cookies at:`, dbPath);

  if (!existsSync(dbPath)) {
    // Fallback to older location (pre-Chrome 90)
    dbPath = path.join(profilePath, "Cookies");
    console.log(`[${browserLabel} Cookies] Modern location not found, trying legacy:`, dbPath);

    if (!existsSync(dbPath)) {
      console.warn(
        `[${browserLabel} Cookies] No cookie database found in:`,
        profilePath,
      );
      console.warn(
        `[${browserLabel} Cookies] Tried: Network/Cookies, Cookies`,
      );
      console.warn(
        `[${browserLabel} Cookies] Note: ${browserType} must have browsed Vinted.com at least once for cookies to be available`,
      );
      return [];
    }
  }

  try {
    const browserPrefix = browserType === "edge" ? "edge" : "chrome";
    const tempDir = mkdtempSync(path.join(os.tmpdir(), `${browserPrefix}-extract-`));
    const tempDbPath = path.join(tempDir, "Cookies");

    try {
      // Always copy to temp folder to avoid file locking issues
      let lastError: Error | null = null;
      let copySucceeded = false;

      // On Windows, if copy fails immediately, skip retries and go to direct read
      const maxRetries = process.platform === "win32" ? 1 : 10;
      const retryDelay = process.platform === "win32" ? 100 : 1000;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          copyFileSafe(dbPath, tempDbPath);
          copySucceeded = true;

          // Also try to copy WAL and SHM files if they exist (SQLite lock files)
          const walPath = dbPath + "-wal";
          const shmPath = dbPath + "-shm";
          if (existsSync(walPath)) {
            try {
              copyFileSafe(walPath, tempDbPath + "-wal");
            } catch (e) {
              // WAL file is optional, don't fail if it can't be copied
              console.log(`[${browserLabel} Cookies] Could not copy WAL file:`, (e as Error).message);
            }
          }
          if (existsSync(shmPath)) {
            try {
              copyFileSafe(shmPath, tempDbPath + "-shm");
            } catch (e) {
              // SHM file is optional, don't fail if it can't be copied
              console.log(`[${browserLabel} Cookies] Could not copy SHM file:`, (e as Error).message);
            }
          }

          console.log(
            `[${browserLabel} Cookies] Successfully copied database to temp folder (attempt ${attempt})`,
          );
          lastError = null;
          break;
        } catch (error) {
          lastError = error as Error;
          const errno = (error as NodeJS.ErrnoException).code;
          console.log(
            `[${browserLabel} Cookies] Copy failed on attempt ${attempt}/${maxRetries}:`,
            (error as NodeJS.ErrnoException).message,
          );

          if ((errno === "EBUSY" || errno === "EACCES") && attempt < maxRetries) {
            const waitTime = retryDelay * attempt; // Exponential backoff
            console.log(
              `[${browserLabel} Cookies] File locked, retrying in ${waitTime}ms (attempt ${attempt}/${maxRetries})...`,
            );
            // Wait before retrying
            const before = Date.now();
            while (Date.now() - before < waitTime) {
              // Busy wait to avoid async complications
            }
          }
        }
      }

      if (!copySucceeded && lastError) {
        // If copy failed after retries, try reading directly from the locked file
        console.log(
          `[${browserLabel} Cookies] Copy failed, attempting to read locked file directly...`,
        );
        try {
          const buffer = readLockedFile(dbPath, browserType);
          console.log(
            `[${browserLabel} Cookies] Successfully read database file directly despite lock`,
          );

          const db = new SQL.Database(buffer);

          // First, check what tables exist
          let tables: unknown[] = [];
          try {
            const tableResults = db.exec(
              "SELECT name FROM sqlite_master WHERE type='table'",
            );
            if (tableResults.length > 0) {
              tables = tableResults[0].values.map((row) => row[0]);
              console.log(`[${browserLabel} Cookies] Available tables:`, tables);
            }
          } catch (e) {
            console.warn(`[${browserLabel} Cookies] Error listing tables:`, e);
          }

          // Try to get the schema of the cookies table
          try {
            const schemaResults = db.exec("PRAGMA table_info(cookies)");
            if (schemaResults.length > 0) {
              const columns = schemaResults[0].values.map((row) => row[1]);
              console.log(`[${browserLabel} Cookies] Cookies table columns:`, columns);
            } else {
              console.warn(`[${browserLabel} Cookies] Cookies table not found!`);
              console.log(`[${browserLabel} Cookies] Available tables were:`, tables);
            }
          } catch (e) {
            console.warn(`[${browserLabel} Cookies] Error checking schema:`, e);
          }

          // Now try the actual query
          let results: Array<{ columns: string[]; values: unknown[][] }> = [];
          try {
            results = db.exec(
              "SELECT name, value, host_key, path, secure, httponly, samesite, expires_utc FROM cookies",
            );
          } catch (queryError) {
            console.warn(`[${browserLabel} Cookies] Query failed:`, (queryError as Error).message);
          }

          console.log(`[${browserLabel} Cookies] Query returned:`, results.length, "result sets");

          if (!results.length || !results[0].values.length) {
            console.warn(`[${browserLabel} Cookies] No cookies found in database or query failed`);
            // Try a simpler query to see if the table exists and has data
            try {
              const simpleResults = db.exec("SELECT COUNT(*) FROM cookies");
              if (simpleResults.length > 0) {
                const count = simpleResults[0].values[0][0];
                console.warn(`[${browserLabel} Cookies] Table has`, count, "rows total");
              }
            } catch (e) {
              console.warn(`[${browserLabel} Cookies] Error counting rows:`, e);
            }
            db.close();
            return [];
          }

          db.close();

          const totalCookies = results[0].values.length;
          console.log(`[${browserLabel} Cookies] Total cookies in database:`, totalCookies);
          console.log(`[${browserLabel} Cookies] Looking for hostname:`, vintedHostname);

          // Log first 10 cookie domains for debugging
          const sampleDomains = results[0].values
            .slice(0, 10)
            .map(([, , hostKey]) => ((hostKey as string) || "").toLowerCase());
          console.log(`[${browserLabel} Cookies] Sample domains in database:`, sampleDomains);

          const filtered = results[0].values
            .filter(([, , hostKey]) => {
              const hostStr = ((hostKey as string) || "").toLowerCase();
              // Remove leading dot for comparison
              const normalizedHost = hostStr.replace(/^\./, "");
              const normalizedHostname = vintedHostname.replace(/^\./, "");

              // Match if it's an exact match or a subdomain match
              const matches =
                normalizedHost === normalizedHostname ||
                normalizedHost.endsWith("." + normalizedHostname);

              if (!matches) {
                console.log(`[${browserLabel} Cookies] Cookie domain`, hostStr, "doesn't match", vintedHostname);
              } else {
                console.log(`[${browserLabel} Cookies] ✓ Matched cookie domain:`, hostStr);
              }
              return matches;
            })
            .map(([name, value, hostKey, pathVal, secure, httpOnly, sameSite, expiresUtc]) => ({
              name: (name as string) || "",
              value: (value as string) || "",
              domain: normalizeCookieDomain((hostKey as string) || ""),
              path: (pathVal as string) || "/",
              expires: expiresUtc
                ? Math.floor((expiresUtc as number) / 1000000)
                : undefined,
              httpOnly: (httpOnly as number) === 1,
              secure: (secure as number) === 1,
              sameSite: sameSite === 1 ? "Lax" : sameSite === 2 ? "Strict" : "None",
            }));

          console.log(
            `[${browserLabel} Cookies] Extracted`,
            filtered.length,
            `out of ${totalCookies} cookies for ${vintedHostname}`,
          );
          return filtered;
        } catch (directReadError) {
          // Check if the browser process is running
          let isRunning = false;
          if (process.platform === "win32") {
            try {
              const exeName = browserType === "edge" ? "msedge.exe" : "chrome.exe";
              execSync(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`, { stdio: "pipe" });
              isRunning = true;
            } catch {
              isRunning = false;
            }
          }

          const browserName = browserType === "edge" ? "Microsoft Edge" : "Google Chrome";
          const runningNote = isRunning ? " It appears to be running right now." : "";
          const errorMsg = `Failed to read ${browserName} database (file is locked).${runningNote} Please close ${browserName} completely (including all windows and background processes) and try again.`;
          throw new Error(errorMsg);
        }
      }

      if (!copySucceeded) {
        throw new Error("Copy failed, will attempt direct read");
      }

      const buffer = readFileSync(tempDbPath);

      const db = new SQL.Database(buffer);

      // First, check what tables exist
      let tables: unknown[] = [];
      try {
        const tableResults = db.exec(
          "SELECT name FROM sqlite_master WHERE type='table'",
        );
        if (tableResults.length > 0) {
          tables = tableResults[0].values.map((row) => row[0]);
          console.log(`[${browserLabel} Cookies] Available tables:`, tables);
        }
      } catch (e) {
        console.warn(`[${browserLabel} Cookies] Error listing tables:`, e);
      }

      // Try to get the schema of the cookies table
      try {
        const schemaResults = db.exec("PRAGMA table_info(cookies)");
        if (schemaResults.length > 0) {
          const columns = schemaResults[0].values.map((row) => row[1]);
          console.log(`[${browserLabel} Cookies] Cookies table columns:`, columns);
        } else {
          console.warn(`[${browserLabel} Cookies] Cookies table not found!`);
          console.log(`[${browserLabel} Cookies] Available tables were:`, tables);
        }
      } catch (e) {
        console.warn(`[${browserLabel} Cookies] Error checking schema:`, e);
      }

      // Now try the actual query
      // Edge uses different column names than Chrome (is_secure instead of secure, etc.)
      let results: Array<{ columns: string[]; values: unknown[][] }> = [];
      try {
        // Try Chrome's column names first
        results = db.exec(
          "SELECT name, value, host_key, path, secure, httponly, samesite, expires_utc FROM cookies",
        );
      } catch (queryError) {
        console.warn(`[${browserLabel} Cookies] Chrome query failed, trying Edge column names:`, (queryError as Error).message);

        // Try Edge's column names
        try {
          results = db.exec(
            "SELECT name, value, host_key, path, is_secure, is_httponly, samesite, expires_utc FROM cookies",
          );
        } catch (edgeQueryError) {
          console.warn(`[${browserLabel} Cookies] Edge query also failed:`, (edgeQueryError as Error).message);
        }
      }

      console.log(`[${browserLabel} Cookies] Query returned:`, results.length, "result sets");

      if (!results.length || !results[0].values.length) {
        console.warn(`[${browserLabel} Cookies] No cookies found in database or query failed`);
        // Try a simpler query to see if the table exists and has data
        try {
          const simpleResults = db.exec("SELECT COUNT(*) FROM cookies");
          if (simpleResults.length > 0) {
            const count = simpleResults[0].values[0][0];
            console.warn(`[${browserLabel} Cookies] Table has`, count, "rows total");
          }
        } catch (e) {
          console.warn(`[${browserLabel} Cookies] Error counting rows:`, e);
        }
        db.close();
        return [];
      }

      db.close();

      const totalCookies = results[0].values.length;
      console.log(`[${browserLabel} Cookies] Total cookies in database:`, totalCookies);
      console.log(`[${browserLabel} Cookies] Looking for hostname:`, vintedHostname);

      // Log first 10 cookie domains for debugging
      const sampleDomains = results[0].values
        .slice(0, 10)
        .map(([, , hostKey]) => ((hostKey as string) || "").toLowerCase());
      console.log(`[${browserLabel} Cookies] Sample domains in database:`, sampleDomains);

      const filtered = results[0].values
        .filter(([, , hostKey]) => {
          const hostStr = ((hostKey as string) || "").toLowerCase();
          // Remove leading dot for comparison
          const normalizedHost = hostStr.replace(/^\./, "");
          const normalizedHostname = vintedHostname.replace(/^\./, "");

          // Match if it's an exact match or a subdomain match
          const matches =
            normalizedHost === normalizedHostname ||
            normalizedHost.endsWith("." + normalizedHostname);

          if (!matches) {
            console.log(`[${browserLabel} Cookies] Cookie domain`, hostStr, "doesn't match", vintedHostname);
          } else {
            console.log(`[${browserLabel} Cookies] ✓ Matched cookie domain:`, hostStr);
          }
          return matches;
        })
        .map(([name, value, hostKey, pathVal, secure, httpOnly, sameSite, expiresUtc]) => ({
          name: (name as string) || "",
          value: (value as string) || "",
          domain: normalizeCookieDomain((hostKey as string) || ""),
          path: (pathVal as string) || "/",
          expires: expiresUtc
            ? Math.floor((expiresUtc as number) / 1000000)
            : undefined,
          httpOnly: (httpOnly as number) === 1,
          secure: (secure as number) === 1,
          sameSite: sameSite === 1 ? "Lax" : sameSite === 2 ? "Strict" : "None",
        }));

      console.log(
        `[${browserLabel} Cookies] Extracted`,
        filtered.length,
        `out of ${totalCookies} cookies for ${vintedHostname}`,
      );
      return filtered;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(`[${browserLabel} Cookies] Error:`, error);
    throw error;
  }
}

export async function extractChromeProfileData(
  profileName: string,
  browserType: "chrome" | "edge",
  vintedBaseUrl: string = "https://www.vinted.com",
): Promise<ExtractionData> {
  try {
    console.log(`[${browserType.toUpperCase()}] Extracting from profile:`, profileName);

    const dataDir = browserType === "chrome" ? getChromeDataDir() : getEdgeDataDir();
    const profilePath = path.join(dataDir, profileName);

    if (!existsSync(profilePath)) {
      throw new Error(`Profile path not found: ${profilePath}`);
    }

    const fingerprint = await extractChromiumFingerprint(browserType);

    const initSqlJs = require("sql.js");
    const SQL: SqlJsStatic = await initSqlJs();

    const cookies = extractChromeCookies(profilePath, SQL, vintedBaseUrl, browserType);
    console.log(`[${browserType.toUpperCase()}] Extracted ${cookies.length} cookies`);

    return {
      fingerprint,
      authentication: {
        cookies,
        origins: [],
      },
    };
  } catch (error) {
    console.error(`[${browserType.toUpperCase()}] Extraction error:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract ${browserType} profile data: ${errorMessage}`);
  }
}
