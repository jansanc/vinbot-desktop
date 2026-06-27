import type { ExtractionData } from "../../types";
import type { SqlJsStatic } from "../../shared/sql-types";
import { convertValue } from "../../shared/vinted-utils";
import { extractFingerprint } from "../../shared/firefox-utils";
import {
  extractCookies,
  extractLocalStorage,
  extractSessionStorage,
} from "../../shared/storage-extraction";

export {
  parseFirefoxPrefs,
  getFirefoxVersion,
  getDefaultFonts,
  extractFingerprint,
} from "../../shared/firefox-utils";

export { extractCookies, extractLocalStorage, extractSessionStorage };

export async function extractFirefoxProfileData(
  profilePath: string,
  vintedBaseUrl: string = "https://www.vinted.com",
): Promise<ExtractionData> {
  try {
    console.log("[Firefox] Extracting from:", profilePath);

    const fingerprint = await extractFingerprint(profilePath);

    const initSqlJs = require("sql.js");
    const SQL: SqlJsStatic = await initSqlJs();

    const cookies = extractCookies(profilePath, SQL, vintedBaseUrl);
    console.log(`[Firefox] Extracted ${cookies.length} cookies`);

    let origins = extractLocalStorage(profilePath, SQL, vintedBaseUrl);
    console.log(`[Firefox] Extracted ${origins.length} localStorage origins`);

    origins.forEach((origin) => {
      origin.localStorage?.forEach((item) => {
        if (typeof item.value !== "string") {
          item.value = convertValue(item.value);
        }
      });
    });

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
