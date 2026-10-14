import { config } from "../config/config";

/**
 * HTTP client for api.vinbot.app.
 *
 * This module runs in the MAIN process only. Requests issued from Node send no
 * Origin header, so they are exempt from the API's CORS policy — which is the
 * point: the renderer is a file:// page in packaged builds, and a file:// page
 * sends `Origin: null`, which the API rejects. Renderer code reaches these
 * methods over IPC via `src/services/api.bridge.ts`.
 *
 * Nothing here may touch `window`, `document` or `localStorage`.
 */

export { UnauthorizedError, CodedError } from "./errors";
import { UnauthorizedError, CodedError } from "./errors";

export interface LoginResponse {
  status: "success" | "fail" | "error";
  message: string;
  data: {
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      aiTokenBudget: {
        monthly: number;
        used: number;
        remaining: number;
        resetDate: string;
      };
      subscriptionTier: string | null;
      billingOverdue: boolean;
      daysUntilBilling: number | null;
    };
    session: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      expiresAt: number;
    };
  };
}

export interface LoginCredentials {
  email: string;
  password: string;
  /** Cloudflare Turnstile token, added by main (src/main/turnstile.ts) */
  captchaToken?: string;
}

export interface DesktopSessionResponse {
  status: "success" | "fail" | "error";
  message: string;
  data: {
    id: string;
    userId: string;
    vintedEmail: string;
    vintedUsername?: string;
    createdAt: string;
    updatedAt: string;
  };
  requestId: string;
}

export class ApiService {
  private static handleAuthError(response: { status: number; statusText: string }): void {
    if (response.status === 401) {
      const timestamp = new Date().toISOString();
      console.error(
        `[${timestamp}] error: [${response.status}] ${response.statusText} User not authenticated`
      );

      // Clearing storage and prompting re-authentication is the renderer's job;
      // the bridge turns this error back into the `auth:unauthorized` event.
      throw new UnauthorizedError("User not authenticated. Please log in again.");
    }
  }

  static async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const endpoint = `${config.api.baseUrl}${config.api.endpoints.auth.login}`;
    try {
      console.log(`[ApiService] Attempting login at: ${endpoint}`);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      // A 401 here is a wrong password, not a dead session: no
      // handleAuthError, which would sign the renderer out of nothing
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new CodedError(
          errorData?.data?.message || errorData?.message || "Login failed",
          errorData?.code,
          response.status
        );
      }

      const data = await response.json();

      if (data.status !== "success") {
        throw new Error(data.message || "Login failed");
      }

      if (!data.data?.session?.accessToken) {
        console.error("Login response missing access token:", data);
        throw new Error("Server did not return access token");
      }

      console.log("Login successful, token obtained:", {
        hasAccessToken: !!data.data.session.accessToken,
        hasRefreshToken: !!data.data.session.refreshToken,
        expiresIn: data.data.session.expiresIn,
      });

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ApiService] Login failed at ${endpoint}:`, {
        error: errorMessage,
        type: error instanceof TypeError ? "Network/DNS Error" : "Application Error",
      });
      throw error instanceof Error ? error : new Error(`Network error: ${errorMessage}`);
    }
  }

  /** Social sign-ins switched on at the API, e.g. { google: true } */
  static async getAuthProviders(): Promise<{ google?: boolean }> {
    const response = await fetch(`${config.api.baseUrl}${config.api.endpoints.auth.providers}`);
    if (!response.ok) throw new Error("Failed to load sign-in options");
    const data = await response.json();
    return data?.data ?? {};
  }

  /**
   * The code the loopback listener got from a Google sign-in and the PKCE
   * verifier it was started with, for a session (src/main/google-sign-in.ts).
   */
  static async exchangeGoogleCode(code: string, codeVerifier: string, locale?: string): Promise<LoginResponse> {
    const response = await fetch(`${config.api.baseUrl}${config.api.endpoints.auth.googleToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The language a new account's emails are in
      body: JSON.stringify({ code, codeVerifier, locale }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.status !== "success") {
      throw new CodedError(
        data?.data?.message || data?.message || "Google sign-in failed",
        data?.code,
        response.status
      );
    }
    if (!data.data?.session?.accessToken) {
      throw new Error("Server did not return access token");
    }
    return data;
  }

  static async refreshToken(refreshToken: string): Promise<LoginResponse> {
    try {
      const response = await fetch(
        `${config.api.baseUrl}${config.api.endpoints.auth.refresh}`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      // Check HTTP status first
      if (!response.ok) {
        ApiService.handleAuthError(response);
        throw new Error("Token refresh failed");
      }

      const data = await response.json();

      // Check for API-level errors
      if (data.status === "fail") {
        if (data.message?.toLowerCase().includes("not authenticated")) {
          throw new UnauthorizedError("Session expired. Please log in again.");
        }
        throw new Error(data.message || "Token refresh failed");
      }

      return data as LoginResponse;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }

  static async getCurrentUser(accessToken: string): Promise<any> {
    try {
      const response = await fetch(
        `${config.api.baseUrl}${config.api.endpoints.auth.me}`,
        {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // Check HTTP status first
      if (!response.ok) {
        ApiService.handleAuthError(response);
        throw new Error("Failed to fetch user");
      }

      const data = await response.json();

      // Check for API-level errors
      if (data.status === "fail") {
        if (data.message?.toLowerCase().includes("not authenticated")) {
          throw new UnauthorizedError("Session expired. Please log in again.");
        }
        throw new Error(data.message || "Failed to fetch user");
      }

      return data;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }

  static async logout(accessToken: string): Promise<void> {
    try {
      const response = await fetch(
        `${config.api.baseUrl}${config.api.endpoints.auth.logout}`,
        {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        // For logout, we don't need to handle 401 specially
        // Just log and continue
        if (response.status === 401) {
          console.warn("Session already expired");
          return;
        }
        throw new Error("Logout failed");
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }

  static async storeDesktopSession(
    accessToken: string,
    payload: {
      vintedEmail: string;
      browserFingerprint: Record<string, any>;
      sessionData: Array<Record<string, any>>;
      sessionOrigins: Array<Record<string, any>>;
      vintedMemberId?: string;
      updateSessionOnly?: boolean;
    }
  ): Promise<DesktopSessionResponse> {
    try {
      const response = await fetch(
        `${config.api.baseUrl}${config.api.endpoints.vinted.link}`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      // Check for HTTP errors first (including 401)
      if (!response.ok) {
        ApiService.handleAuthError(response);
        const errorData = await response.json();
        throw new Error(
          errorData.data?.message || errorData.message || "Failed to store desktop session"
        );
      }

      const data = await response.json();

      // Check for API-level errors (status: "fail")
      if (data.status === "fail") {
        // Check if it's an authentication error
        if (
          data.message?.toLowerCase().includes("not authenticated") ||
          data.message?.toLowerCase().includes("unauthorized")
        ) {
          const timestamp = new Date().toISOString();
          console.error(
            `[${timestamp}] error: [401] ${data.message} User not authenticated`
          );

          throw new UnauthorizedError(data.message || "User not authenticated. Please log in again.");
        }

        throw new Error(
          data.data?.message || data.message || "Failed to store desktop session"
        );
      }

      return data as DesktopSessionResponse;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }
}
