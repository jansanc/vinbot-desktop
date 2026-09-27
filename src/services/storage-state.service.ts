/**
 * Storage State Service
 *
 * Captures Playwright context's storage state (cookies + localStorage)
 * along with context configuration for rehydration.
 *
 * Replaces full browser profile backup (434MB) with small JSON (~5-10KB).
 */

import * as fs from "fs";
import * as path from "path";

export interface StorageStateContextConfig {
  // Browser fingerprint (DataDome-critical)
  userAgent: string;
  locale: string;
  timezoneId: string;
  viewport: {
    width: number;
    height: number;
  };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  capturedAt: number;
}

export interface CookieData {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface LocalStorageData {
  [origin: string]: {
    [key: string]: string;
  };
}

export interface StorageState {
  cookies: CookieData[];
  origins?: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
  contextConfig: StorageStateContextConfig;
}

export class StorageStateService {
  /**
   * Extract storage state from Playwright context
   * Returns small JSON (~5-10KB) instead of 434MB profile
   */
  static async captureStorageState(
    context: any, // playwright.BrowserContext
    contextConfig: Omit<StorageStateContextConfig, "capturedAt">
  ): Promise<StorageState> {
    if (!context) {
      throw new Error("No Playwright context provided");
    }

    try {
      // Get storage state from Playwright (cookies + localStorage)
      const state = await context.storageState();

      // Ensure contextConfig has capturedAt timestamp
      const config: StorageStateContextConfig = {
        ...contextConfig,
        capturedAt: Date.now(),
      };

      return {
        cookies: state.cookies || [],
        origins: state.origins || [],
        contextConfig: config,
      };
    } catch (error) {
      throw new Error(
        `Failed to capture storage state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Save storage state to file
   */
  static async saveStorageState(
    filePath: string,
    state: StorageState
  ): Promise<void> {
    try {
      const directory = path.dirname(filePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }

      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
      console.log(
        `[StorageStateService] Saved storage state to ${filePath} (${JSON.stringify(state).length} bytes)`
      );
    } catch (error) {
      throw new Error(
        `Failed to save storage state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load storage state from file
   */
  static async loadStorageState(filePath: string): Promise<StorageState> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Storage state file not found: ${filePath}`);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const state = JSON.parse(content) as StorageState;

      if (!state.contextConfig) {
        throw new Error("Storage state missing contextConfig");
      }

      console.log(
        `[StorageStateService] Loaded storage state from ${filePath}`
      );
      return state;
    } catch (error) {
      throw new Error(
        `Failed to load storage state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get storage state size
   */
  static getStorageStateSize(state: StorageState): number {
    return JSON.stringify(state).length;
  }

  /**
   * Get summary of storage state
   */
  static getSummary(state: StorageState): {
    cookieCount: number;
    origins: number;
    totalSize: number;
    criticalCookies: string[];
  } {
    const criticalCookies = state.cookies
      .filter((c) =>
        c.name.includes("token") ||
        c.name.includes("auth") ||
        c.name.includes("datadome") ||
        c.name.includes("session")
      )
      .map((c) => c.name);

    return {
      cookieCount: state.cookies.length,
      origins: state.origins?.length || 0,
      totalSize: this.getStorageStateSize(state),
      criticalCookies,
    };
  }

  /**
   * Compare two storage states (useful for debugging)
   */
  static compare(
    state1: StorageState,
    state2: StorageState
  ): {
    newCookies: string[];
    removedCookies: string[];
    updatedCookies: string[];
  } {
    const cookies1 = new Map(state1.cookies.map((c) => [c.name, c.value]));
    const cookies2 = new Map(state2.cookies.map((c) => [c.name, c.value]));

    const newCookies = Array.from(cookies2.keys()).filter(
      (name) => !cookies1.has(name)
    );
    const removedCookies = Array.from(cookies1.keys()).filter(
      (name) => !cookies2.has(name)
    );
    const updatedCookies = Array.from(cookies1.keys()).filter(
      (name) =>
        cookies2.has(name) && cookies1.get(name) !== cookies2.get(name)
    );

    return {
      newCookies,
      removedCookies,
      updatedCookies,
    };
  }
}
