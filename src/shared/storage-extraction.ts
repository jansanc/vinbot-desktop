import path from "path";
import { readFileSync, existsSync, readdirSync } from "fs";
import type { Cookie, StorageOrigin, LocalStorageItem } from "../types";
import type { SqlJsStatic } from "./sql-types";
import {
  getVintedHostname,
  normalizeCookieDomain,
  isAuthRelatedStorage,
  convertValue,
} from "./vinted-utils";

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
        return hostStr.includes(vintedHostname);
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
