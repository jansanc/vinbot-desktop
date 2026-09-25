import { app, safeStorage } from "electron";
import path from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { ApiService } from "../../services/api.service";

/**
 * Authoritative session store for the main process.
 *
 * The renderer used to be the only holder of the access token (in localStorage),
 * which left main-process callers — profile uploads, the Vinted link call —
 * reading an empty in-memory fallback and failing silently. Main owns the
 * session now; the renderer keeps only what it needs to gate the UI.
 *
 * Tokens are persisted encrypted via Electron's safeStorage (OS keychain /
 * DPAPI) so they survive a restart without sitting on disk in the clear. When
 * the platform has no encryption backend available the session stays in memory
 * only and the user logs in again next launch.
 */

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

let cached: StoredSession | null = null;
let loaded = false;

function sessionFilePath(): string {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "session.enc");
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function loadFromDisk(): StoredSession | null {
  try {
    const file = sessionFilePath();
    if (!existsSync(file)) return null;
    if (!canEncrypt()) return null;

    const decrypted = safeStorage.decryptString(readFileSync(file));
    const parsed = JSON.parse(decrypted) as StoredSession;
    if (!parsed?.accessToken) return null;
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[TokenStore] Could not read persisted session:", message);
    return null;
  }
}

function persist(session: StoredSession | null): void {
  const file = sessionFilePath();
  try {
    if (!session) {
      if (existsSync(file)) unlinkSync(file);
      return;
    }
    if (!canEncrypt()) {
      console.warn("[TokenStore] safeStorage unavailable; session kept in memory only");
      return;
    }
    writeFileSync(file, safeStorage.encryptString(JSON.stringify(session)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[TokenStore] Could not persist session:", message);
  }
}

export const tokenStore = {
  get(): StoredSession | null {
    if (!loaded) {
      cached = loadFromDisk();
      loaded = true;
    }
    return cached;
  },

  set(session: StoredSession): void {
    cached = session;
    loaded = true;
    persist(session);
  },

  clear(): void {
    cached = null;
    loaded = true;
    persist(null);
  },

  /**
   * Token for an outbound API call. Callers may pass one explicitly (the
   * renderer still threads it through some component props); anything blank
   * falls back to the stored session.
   */
  resolveAccessToken(provided?: string): string {
    const candidate = provided?.trim();
    if (candidate) return candidate;

    const session = this.get();
    if (!session?.accessToken) {
      throw new Error("No authenticated session found. Please log in again.");
    }
    return session.accessToken;
  },

  /**
   * Token for a call that starts now, refreshing the stored session first when
   * it is about to expire. The token the renderer passes was read when its page
   * mounted - a login window alone can stay open for an hour after that - so an
   * upload used to fail with 401 at the very end, after the user had logged in.
   *
   * The stored session is never older than the renderer's (every login and
   * refresh goes through main), so it wins; `provided` is only the fallback for
   * when nothing is stored (no safeStorage backend, after a restart).
   * `onRefreshed` hands a new session to whoever keeps a copy of it.
   */
  async freshAccessToken(
    provided?: string,
    onRefreshed?: (session: StoredSession) => void
  ): Promise<string> {
    const stored = this.get();
    if (stored?.accessToken) {
      const expiresAtMs = stored.expiresAt * 1000;
      if (!stored.expiresAt || expiresAtMs - 60_000 > Date.now()) return stored.accessToken;

      if (stored.refreshToken) {
        const response = await ApiService.refreshToken(stored.refreshToken);
        const session = response.data?.session;
        if (session?.accessToken) {
          this.set(session);
          onRefreshed?.(session);
          return session.accessToken;
        }
      }
    }
    return this.resolveAccessToken(provided);
  },
};
