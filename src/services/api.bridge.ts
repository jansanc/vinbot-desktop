import { config } from "../config/config";
import type { LoginCredentials, LoginResponse } from "./api.service";

/**
 * Renderer-side stand-in for ApiService.
 *
 * Every call is forwarded over IPC and performed by the main process, which
 * sends no Origin header and is therefore exempt from the API's CORS policy.
 * Nothing in the renderer talks to api.vinbot.app directly — a packaged build
 * loads from file://, whose Origin is the literal string "null" and is
 * rejected by the API.
 */

export { UnauthorizedError } from "./errors";
import { UnauthorizedError } from "./errors";

type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { name: string; message: string } };

function onUnauthorized(message: string): UnauthorizedError {
  try {
    localStorage.removeItem(config.storage.keys.session);
    localStorage.removeItem(config.storage.keys.user);
  } catch {
    // localStorage can be unavailable; the memory store below still clears.
  }
  config.storage.memoryStore.clear();

  window.dispatchEvent(
    new CustomEvent("auth:unauthorized", {
      detail: { status: 401, statusText: "Unauthorized", message },
    })
  );

  return new UnauthorizedError(message);
}

function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data;

  if (result.error.name === "UnauthorizedError") {
    throw onUnauthorized(result.error.message);
  }
  throw new Error(result.error.message);
}

function bridge() {
  const api = window.electronAPI;
  if (!api?.auth) {
    throw new Error(
      "Electron auth bridge unavailable. The app must run inside Electron."
    );
  }
  return api.auth;
}

export class ApiBridge {
  static async login(credentials: LoginCredentials): Promise<LoginResponse> {
    return unwrap(await bridge().login(credentials));
  }

  // Tokens are optional throughout: main uses its stored session when none is
  // given, and the renderer no longer holds any.
  static async refreshToken(refreshToken?: string): Promise<LoginResponse> {
    return unwrap(await bridge().refresh(refreshToken));
  }

  static async getCurrentUser(accessToken?: string): Promise<any> {
    return unwrap(await bridge().me(accessToken));
  }

  static async logout(accessToken?: string): Promise<void> {
    await unwrap(await bridge().logout(accessToken));
  }
}
