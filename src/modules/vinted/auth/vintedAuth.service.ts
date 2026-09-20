import type { Fingerprint } from "../../../types";
import { ApiService } from "../../../services/api.service";
import { tokenStore } from "../../../main/api/token-store";

export interface AuthData {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: string;
  }>;
  origins: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
    sessionStorage?: Array<{ name: string; value: string }>;
  }>;
}

export interface StoreDesktopSessionResult {
  id: string;
  userId: string;
  vintedEmail: string;
  vintedUsername?: string;
  createdAt: string;
  updatedAt: string;
  message: string;
}

export async function saveFirefoxExtractionData(
  vintedEmail: string,
  fingerprint: Fingerprint,
  auth: AuthData,
  userEmail: string,
  vintedMemberId?: string,
  accessToken?: string,
): Promise<StoreDesktopSessionResult> {
  try {
    // Runs in the main process: the session comes from the main-process token
    // store, never from the renderer's localStorage (unreachable from here).
    const token = tokenStore.resolveAccessToken(accessToken);

    console.log("Storing Firefox extraction data via API:", {
      vintedEmail,
      userEmail,
      vintedMemberId,
      cookiesCount: auth.cookies.length,
      originsCount: auth.origins.length,
    });

    const response = await ApiService.storeDesktopSession(
      token,
      {
        vintedEmail,
        browserFingerprint: fingerprint,
        sessionData: auth.cookies,
        sessionOrigins: auth.origins,
        vintedMemberId,
        updateSessionOnly: false,
      }
    );

    if (response.status !== "success") {
      throw new Error(response.message || "Failed to store desktop session data");
    }

    console.log("Desktop session data stored successfully:", response.data);

    return {
      ...response.data,
      message: response.message,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to save Firefox extraction data:", errorMessage);
    throw new Error(
      `Failed to store session data: ${errorMessage}`
    );
  }
}
