import { ipcMain } from "electron";
import { ApiService, UnauthorizedError } from "../../services/api.service";
import { tokenStore } from "./token-store";

/**
 * Main-process IPC surface for every authenticated API call the UI makes.
 *
 * Requests leave from Node, so no Origin header is sent and the API's CORS
 * policy never applies. The renderer no longer calls fetch() against
 * api.vinbot.app at all.
 */

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { name: string; message: string } };

/**
 * `ipcRenderer.invoke` rewraps thrown errors ("Error invoking remote method
 * ..."), which would destroy the UnauthorizedError signal the renderer keys
 * off. Results are returned as a plain envelope instead.
 */
/**
 * What the renderer gets of a session: when it expires, never the tokens. Main
 * keeps them (encrypted, see token-store) and uses them itself for every call,
 * so a compromised or buggy page has nothing to leak or persist in the clear.
 */
export function redactSession<S extends { expiresIn: number; expiresAt: number }>(session: S) {
  return { expiresIn: session.expiresIn, expiresAt: session.expiresAt };
}

function withoutTokens<R extends { data?: { session?: any } }>(response: R): R {
  const session = response.data?.session;
  if (!session) return response;
  return { ...response, data: { ...response.data, session: redactSession(session) } };
}

async function run<T>(operation: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const name =
      error instanceof UnauthorizedError
        ? "UnauthorizedError"
        : error instanceof Error
          ? error.name
          : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { name, message } };
  }
}

export function registerAuthHandlers(): void {
  ipcMain.handle("api:login", async (_event, credentials: { email: string; password: string }) =>
    run(async () => {
      const response = await ApiService.login(credentials);
      const session = response.data?.session;

      if (session?.accessToken) {
        tokenStore.set(session);
      }

      return withoutTokens(response);
    })
  );

  ipcMain.handle("api:me", async (_event, accessToken?: string) =>
    run(() => ApiService.getCurrentUser(tokenStore.resolveAccessToken(accessToken)))
  );

  ipcMain.handle("api:refresh", async (_event, refreshToken?: string) =>
    run(async () => {
      const token = refreshToken?.trim() || tokenStore.get()?.refreshToken;
      if (!token) {
        throw new UnauthorizedError("No refresh token available. Please log in again.");
      }

      const response = await ApiService.refreshToken(token);
      const session = response.data?.session;

      if (session?.accessToken) {
        tokenStore.set(session);
      }

      return withoutTokens(response);
    })
  );

  ipcMain.handle("api:logout", async (_event, accessToken?: string) =>
    run(async () => {
      const token = accessToken?.trim() || tokenStore.get()?.accessToken;

      // Clear locally even if the remote call fails: the user asked to log out.
      try {
        if (token) await ApiService.logout(token);
      } finally {
        tokenStore.clear();
      }

      return { success: true };
    })
  );

  // Lets the renderer restore a session on launch without holding the tokens
  // itself: only expiry and presence are reported back.
  ipcMain.handle("api:getStoredSession", async () =>
    run(async () => {
      const session = tokenStore.get();
      if (!session) return null;
      return {
        hasSession: true,
        expiresAt: session.expiresAt,
        expiresIn: session.expiresIn,
      };
    })
  );

  console.log("[IPC] Auth handlers registered");
}
