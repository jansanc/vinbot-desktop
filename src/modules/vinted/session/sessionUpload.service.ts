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
}

export class SessionUploadService {
  /**
   * Upload session to API endpoint (which then stores to Supabase/S3)
   */
  static async uploadSessionToAPI(
    session: ExtractedSession,
    options: SessionUploadOptions
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      const payload = {
        vintedEmail: options.vintedEmail,
        vintedMemberId: options.vintedMemberId || "",
        session: {
          cookies: session.cookies,
          localStorage: session.storage.localStorage,
          sessionStorage: session.storage.sessionStorage,
          profile_name: session.profile_name,
          profile_path: session.profile_path,
          extracted_at: session.extracted_at,
        },
        userEmail: options.userEmail,
      };

      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };

      if (options.accessToken) {
        headers["Authorization"] = `Bearer ${options.accessToken}`;
      }

      const response = await fetch(
        `${config.api.baseUrl}/api/v1/integrations/vinted/session/upload`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `Upload failed with status ${response.status}`
        );
      }

      const data = await response.json();
      return {
        success: true,
        id: data.data?.id,
        message: data.message || "Session uploaded successfully",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SessionUploadService] API upload failed:", message);
      return {
        success: false,
        message: `Upload failed: ${message}`,
      };
    }
  }

  /**
   * Upload session to Supabase directly
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
