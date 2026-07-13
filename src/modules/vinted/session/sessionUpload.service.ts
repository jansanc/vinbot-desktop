import { config } from "../../../config/config";
import type { ExtractedSession } from "./sessionExtractor";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SessionUploadOptions {
  userEmail: string;
  vintedEmail: string;
  vintedMemberId?: string;
  accessToken?: string;
  profileLocation?: string; // S3 path to the browser profile archive
  profileS3?: string; // S3 path to store in vinted_accounts.profile_s3
}

export interface LinkVintedAccountPayload {
  vintedEmail: string;
  vinted_member_id?: string;
  sessionData: Array<Record<string, unknown>>;
  sessionOrigins: Array<Record<string, unknown>>;
  browserFingerprint: Record<string, unknown>;
  profile_s3?: string; // S3 path to the browser profile archive
}

export interface SessionHealthCheckResult {
  success: boolean;
  healthy: boolean;
  profileValid: boolean;
  message: string;
  profile?: {
    memberId?: string;
    email?: string;
    username?: string;
    country?: string;
  };
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
  ): Promise<{ success: boolean; id?: string; message: string }> {
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

      // Add S3 profile path if available
      if (options.profileS3) {
        linkPayload.profile_s3 = options.profileS3;
      }

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

  /**
   * Check if the Vinted session is healthy and profile is valid.
   * Calls /api/v1/integrations/vinted/session/health to verify session status.
   */
  static async checkSessionHealth(
    session: ExtractedSession,
    options: SessionUploadOptions
  ): Promise<SessionHealthCheckResult> {
    try {
      // Ensure access token is provided
      if (!options.accessToken || options.accessToken.trim() === "") {
        console.error("[SessionUploadService] Missing access token for session health check");
        return {
          success: false,
          healthy: false,
          profileValid: false,
          message: "Session error: Access token required. Your session may have expired.",
        };
      }

      const headers: HeadersInit = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.accessToken}`,
      };

      const sessionData = session.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expires: cookie.expires,
      }));

      const healthCheckPayload: Record<string, unknown> = {
        sessionData,
        vintedEmail: options.vintedEmail,
      };

      if (options.profileLocation) {
        healthCheckPayload.profileLocation = options.profileLocation;
      }

      console.log("[SessionUploadService] Checking session health:", {
        vintedEmail: options.vintedEmail,
        endpoint: `${config.api.baseUrl}/api/v1/integrations/vinted/session/health`,
        hasProfileLocation: !!options.profileLocation,
        profileLocation: options.profileLocation ? options.profileLocation.substring(0, 50) + "..." : "none",
        cookieCount: session.cookies.length,
        cookies: session.cookies.map((c) => ({
          name: c.name,
          hasDomain: !!c.domain,
          hasValue: !!c.value,
          valueLength: c.value?.length || 0,
          secure: c.secure,
          httpOnly: c.httpOnly,
          path: c.path,
          expires: c.expires,
        })),
      });

      console.log("[SessionUploadService] Payload being sent:", {
        vintedEmail: options.vintedEmail,
        hasProfileLocation: !!options.profileLocation,
        sessionDataCount: sessionData.length,
        sessionDataDetails: sessionData.map((c) => ({
          name: c.name,
          valueSample: c.value ? c.value.substring(0, 20) + "..." : "empty",
          valueLength: c.value?.length || 0,
        })),
      });

      const response = await fetch(
        `${config.api.baseUrl}/api/v1/integrations/vinted/session/health`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(healthCheckPayload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.message || `Health check failed with status ${response.status}`;
        console.warn("[SessionUploadService] Session health check failed:", {
          status: response.status,
          statusText: response.statusText,
          message: errorMsg,
          fullResponse: errorData,
        });
        return {
          success: false,
          healthy: false,
          profileValid: false,
          message: errorMsg,
        };
      }

      const data = await response.json();
      console.log("[SessionUploadService] Health check response received:", {
        fullResponse: JSON.stringify(data, null, 2),
        status: data.status,
        message: data.message,
      });

      // Parse response - backend returns health_status, is_logged_in
      const healthData = data.data;
      const healthStatus = healthData?.health_status || healthData?.isHealthy || false;
      const isLoggedIn = healthData?.is_logged_in ?? healthData?.isAuthenticated ?? false;
      const accountEmail = healthData?.accountEmail;

      // profileValid is true only if session is healthy AND authenticated
      const isHealthy = healthStatus === "healthy" || healthStatus === true;
      const isAuthenticated = isLoggedIn === true;
      const isProfileValid = isHealthy && isAuthenticated;

      // Construct profile from available data
      const profile = isProfileValid ? {
        email: accountEmail,
      } : undefined;

      console.log("[SessionUploadService] Session health check result parsed:", {
        healthy: isHealthy,
        authenticated: isAuthenticated,
        profileValid: isProfileValid,
        healthStatus: healthStatus,
        isLoggedIn: isLoggedIn,
        accountEmail: accountEmail ? accountEmail.substring(0, 10) + "..." : "none",
        hasProfile: !!profile,
        profileKeys: profile ? Object.keys(profile) : [],
        backendMessage: healthData?.reason ? healthData.reason.substring(0, 100) : "none",
      });

      return {
        success: true,
        healthy: isHealthy,
        profileValid: isProfileValid,
        message: data.message || "Session health check completed",
        profile,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[SessionUploadService] Session health check error:", message);
      return {
        success: false,
        healthy: false,
        profileValid: false,
        message: `Health check error: ${message}`,
      };
    }
  }

  /**
   * Upload session to Supabase directly
   * @deprecated Use linkVintedAccount instead for consolidated flow
   */
  static async uploadToSupabase(
    session: ExtractedSession,
    supabaseConfig: SupabaseConfig,
    options: SessionUploadOptions
  ): Promise<{ success: boolean; message: string }> {
    try {
      const sessionRecord = {
        vinted_email: options.vintedEmail,
        vinted_member_id: options.vintedMemberId,
        user_email: options.userEmail,
        cookies: JSON.stringify(session.cookies),
        profile_name: session.profile_name,
        extracted_at: new Date(session.extracted_at).toISOString(),
      };

      const response = await fetch(
        `${supabaseConfig.url}/rest/v1/vinted_sessions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseConfig.anonKey,
            Authorization: `Bearer ${supabaseConfig.anonKey}`,
          },
          body: JSON.stringify(sessionRecord),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `Supabase upload failed with status ${response.status}`
        );
      }

      return {
        success: true,
        message: "Session uploaded to Supabase successfully",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SessionUploadService] Supabase upload failed:", message);
      return {
        success: false,
        message: `Supabase upload failed: ${message}`,
      };
    }
  }

  /**
   * Upload session to S3 directly
   * @deprecated Use linkVintedAccount instead for consolidated flow
   * Note: Requires AWS SDK or presigned URL approach
   */
  static async uploadToS3(
    session: ExtractedSession,
    s3Config: S3Config,
    options: SessionUploadOptions
  ): Promise<{ success: boolean; message: string }> {
    try {
      // For now, return a placeholder indicating S3 upload setup
      // In production, you'd use AWS SDK or a presigned URL from your backend
      const key = `vinted-sessions/${options.userEmail}/${options.vintedEmail}/${Date.now()}.json`;

      const sessionData = {
        vinted_email: options.vintedEmail,
        vinted_member_id: options.vintedMemberId,
        user_email: options.userEmail,
        cookies: session.cookies,
        profile_name: session.profile_name,
        extracted_at: new Date(session.extracted_at).toISOString(),
      };

      // This would normally use AWS SDK
      console.log(`[SessionUploadService] S3 upload would save to: s3://${s3Config.bucket}/${key}`);

      // For now, we recommend using the API endpoint instead
      return {
        success: false,
        message: "S3 direct upload not yet implemented. Use API endpoint instead.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SessionUploadService] S3 upload failed:", message);
      return {
        success: false,
        message: `S3 upload failed: ${message}`,
      };
    }
  }
}
