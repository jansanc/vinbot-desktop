import { config } from "../config/config";

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

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
  private static handleAuthError(response: Response): void {
    if (response.status === 401) {
      const timestamp = new Date().toISOString();
      const message = `[${timestamp}] error: [${response.status}] ${response.statusText} User not authenticated`;
      console.error(message);

      // Clear stored session and user data
      localStorage.removeItem(config.storage.keys.session);
      localStorage.removeItem(config.storage.keys.user);
      config.storage.memoryStore.clear();

      // Dispatch event to trigger re-authentication
      window.dispatchEvent(
        new CustomEvent("auth:unauthorized", {
          detail: { status: response.status, statusText: response.statusText },
        })
      );

      throw new UnauthorizedError("User not authenticated. Please log in again.");
    }
  }

  static async login(credentials: LoginCredentials): Promise<LoginResponse> {
    try {
      const response = await fetch(
        `${config.api.baseUrl}${config.api.endpoints.auth.login}`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        ApiService.handleAuthError(response);
        const errorData = await response.json();
        throw new Error(
          errorData.data?.message || errorData.message || "Login failed"
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
      throw error instanceof Error ? error : new Error("Network error");
    }
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
        `${config.api.baseUrl}${config.api.endpoints.vinted.desktopSession}`,
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

          // Clear stored session and user data
          localStorage.removeItem(config.storage.keys.session);
          localStorage.removeItem(config.storage.keys.user);
          config.storage.memoryStore.clear();

          // Dispatch event to trigger re-authentication
          window.dispatchEvent(
            new CustomEvent("auth:unauthorized", {
              detail: { status: 401, statusText: "Unauthorized", message: data.message },
            })
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

  static async uploadBrowserProfile(
    accessToken: string,
    payload: {
      browser: "chrome" | "firefox" | "edge";
      profileId: string;
      profileName: string;
      vintedAccountId: string;
      userId: string;
      profileData: Buffer | Blob | string; // Binary or base64 string
      compressedSize: number;
      originalSize: number;
      metadata: string;
      userEmail?: string;
      vintedEmail?: string;
      vintedMemberId?: string;
    }
  ): Promise<any> {
    try {
      const isBinary = payload.profileData instanceof Buffer || payload.profileData instanceof Blob;

      // Use raw binary POST for binary uploads (no string limit, direct to server)
      if (isBinary) {
        let binaryData: ArrayBuffer | Uint8Array;

        if (payload.profileData instanceof Buffer) {
          binaryData = payload.profileData.buffer.slice(
            payload.profileData.byteOffset,
            payload.profileData.byteOffset + payload.profileData.byteLength
          );
        } else if (payload.profileData instanceof Blob) {
          binaryData = await payload.profileData.arrayBuffer();
        } else {
          throw new Error("Invalid profile data type");
        }

        const response = await fetch(
          `${config.api.baseUrl}/api/v1/integrations/vinted/profile/upload`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              Authorization: `Bearer ${accessToken}`,
              // Send metadata as headers to avoid parsing issues
              "X-Browser": payload.browser,
              "X-Profile-Id": payload.profileId,
              "X-Profile-Name": payload.profileName,
              "X-Vinted-Account-Id": payload.vintedAccountId,
              "X-User-Id": payload.userId,
              "X-Compressed-Size": String(payload.compressedSize),
              "X-Original-Size": String(payload.originalSize),
              "X-Metadata": payload.metadata,
              ...(payload.userEmail && { "X-User-Email": payload.userEmail }),
              ...(payload.vintedEmail && { "X-Vinted-Email": payload.vintedEmail }),
              ...(payload.vintedMemberId && { "X-Vinted-Member-Id": payload.vintedMemberId }),
            },
            body: binaryData,
          }
        );

        if (!response.ok) {
          ApiService.handleAuthError(response);
          let errorData: any = {};
          try {
            errorData = await response.json();
          } catch {
            // Response might not be JSON
          }
          const errorMsg = errorData?.data?.message || errorData?.message || response.statusText;
          console.error("[ApiService] Upload failed with status", response.status, ":", errorMsg);
          throw new Error(
            `Upload failed (${response.status}): ${errorMsg}`
          );
        }

        const data = await response.json();

        if (data.status === "fail" || data.status === "error") {
          if (
            data.message?.toLowerCase().includes("not authenticated") ||
            data.message?.toLowerCase().includes("unauthorized")
          ) {
            throw new UnauthorizedError(data.message || "User not authenticated. Please log in again.");
          }
          console.error("[ApiService] Upload rejected by API:", data.message || data);
          throw new Error(data.message || "Failed to upload profile");
        }

        return data;
      } else {
        // Fallback to legacy base64 JSON endpoint for string data
        const response = await fetch(
          `${config.api.baseUrl}/api/v1/integrations/vinted/profile/upload/legacy`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              ...payload,
              profileData: payload.profileData,
            }),
          }
        );

        if (!response.ok) {
          ApiService.handleAuthError(response);
          const errorData = await response.json();
          throw new Error(
            errorData.data?.message || errorData.message || "Failed to upload profile"
          );
        }

        const data = await response.json();

        if (data.status === "fail" || data.status === "error") {
          if (
            data.message?.toLowerCase().includes("not authenticated") ||
            data.message?.toLowerCase().includes("unauthorized")
          ) {
            throw new UnauthorizedError(data.message || "User not authenticated. Please log in again.");
          }
          throw new Error(data.message || "Failed to upload profile");
        }

        return data;
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }

  static async downloadBrowserProfile(
    profileId: string,
    accessToken: string
  ): Promise<ArrayBuffer> {
    try {
      const response = await fetch(
        `${config.api.baseUrl}/api/v1/integrations/vinted/profile/download/${profileId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        ApiService.handleAuthError(response);
        throw new Error("Failed to download profile");
      }

      return response.arrayBuffer();
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }
}
