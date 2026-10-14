import { config } from "../../../config/config";

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly?: boolean;
  expires?: number;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface SessionStorage {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/** A captured Vinted session, as sent to the link endpoint. */
export interface ExtractedSession {
  url: string;
  cookies: SessionCookie[];
  storage: SessionStorage;
  user_agent?: string;
  extracted_at: number;
}

export interface SessionUploadOptions {
  userEmail: string;
  vintedEmail: string;
  vintedMemberId?: string;
  accessToken?: string;
}

export interface LinkVintedAccountPayload {
  vintedEmail: string;
  vinted_member_id?: string;
  sessionData: Array<Record<string, unknown>>;
  sessionOrigins: Array<Record<string, unknown>>;
  browserFingerprint: Record<string, unknown>;
}

export class SessionUploadService {
  /**
   * Link and upload Vinted account session in a single request.
   * Sends extracted session data, browser fingerprint, and account info to the consolidated endpoint.
   * This single endpoint handles:
   * - Creating vinted_accounts record
   * - Storing session data and browser fingerprint
   * - Linking the account to the authenticated user
   */
  static async linkVintedAccount(
    session: ExtractedSession,
    options: SessionUploadOptions
  ): Promise<{ success: boolean; id?: string; message: string; unauthorized?: boolean }> {
    try {
      // Ensure access token is provided
      if (!options.accessToken || options.accessToken.trim() === "") {
        console.error("[SessionUploadService] Missing access token for account linking");
        return {
          success: false,
          message: "Session error: Access token required. Your session may have expired.",
        };
      }

      const headers: HeadersInit = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.accessToken}`,
      };

      // Prepare the consolidated payload for /vinted/auth/link
      // Convert SessionCookie to the API format (Record<string, unknown>[])
      const sessionData = session.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expires: cookie.expires,
        ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      } as Record<string, unknown>));

      // Convert storage to sessionOrigins format for API
      // API expects array of origins with localStorage items
      const localStorageItems = session.storage.localStorage
        ? Object.entries(session.storage.localStorage).map(([name, value]) => ({
            name,
            value,
          }))
        : [];

      const sessionOrigins = [
        {
          origin: session.url || ".vinted.com",
          localStorage: localStorageItems,
        } as Record<string, unknown>,
      ];

      const linkPayload: LinkVintedAccountPayload = {
        vintedEmail: options.vintedEmail,
        vinted_member_id: options.vintedMemberId,
        sessionData,
        sessionOrigins,
        browserFingerprint: {},
      };

      console.log("[SessionUploadService] Linking Vinted account with consolidated endpoint:", {
        vintedEmail: options.vintedEmail,
        endpoint: `${config.api.baseUrl}${config.api.endpoints.vinted.link}`,
        cookieCount: session.cookies.length,
        storageSize: Object.keys(session.storage.localStorage).length,
      });

      const response = await fetch(
        `${config.api.baseUrl}${config.api.endpoints.vinted.link}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(linkPayload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.message || `Link failed with status ${response.status}`;
        console.warn("[SessionUploadService] Account link warning:", {
          status: response.status,
          message: errorMsg,
        });
        // Don't fail the entire flow if link fails, just warn
        return {
          success: false,
          message: `Account link note: ${errorMsg}`,
          unauthorized: response.status === 401,
        };
      }

      const data = await response.json();
      const accountId = data.data?.id || data.id;
      console.log("[SessionUploadService] Account linked successfully:", {
        accountId,
        vintedEmail: options.vintedEmail,
      });

      return {
        success: true,
        id: accountId,
        message: data.message || "Account linked successfully",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[SessionUploadService] Account link warning:", message);
      // Don't fail the entire flow, just log the warning
      return {
        success: false,
        message: `Link note: ${message}`,
      };
    }
  }
}
