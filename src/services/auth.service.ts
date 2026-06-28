import { ApiService, LoginResponse } from "./api.service";
import { config } from "../config/config";
import { storage } from "../config/storage";

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export interface AuthUser {
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
}

const STORAGE_KEYS = config.storage.keys;
const VALID_SUBSCRIPTION_TIERS = ["basic", "pro", "enterprise"];

export class AuthService {
  static isValidSubscriptionTier(tier: string | null): boolean {
    // Reject null, undefined, or empty values
    if (!tier || typeof tier !== "string") {
      console.warn(`[Auth] ❌ Invalid subscription tier: type=${typeof tier}, value="${tier}"`);
      return false;
    }

    console.log(`[Auth] Subscription tier validation: input="${tier}", type="${typeof tier}"`);

    const normalizedTier = tier.trim().toLowerCase();
    console.log(`[Auth] After normalization: "${normalizedTier}"`);

    // Explicitly check if tier is in the valid list
    const isValid = normalizedTier === "basic" || normalizedTier === "pro" || normalizedTier === "enterprise";

    console.log(`[Auth] Validation result: ${isValid ? "✅ PASS" : "❌ FAIL"} (valid=${isValid})`);

    if (!isValid) {
      console.error(`[Auth] ❌ REJECTED: "${tier}" → normalized: "${normalizedTier}". Valid tiers: basic, pro, enterprise`);
    }

    return isValid;
  }

  static async login(
    email: string,
    password: string
  ): Promise<{ user: AuthUser; session: Session }> {
    const response = await ApiService.login({ email, password });

    if (response.status !== "success") {
      throw new Error(response.message);
    }

    const session = response.data.session;
    const user = response.data.user;

    if (!session?.accessToken) {
      throw new Error("Server did not return access token");
    }

    console.log(`[Auth] Login response subscription tier: "${user.subscriptionTier}"`);

    if (!this.isValidSubscriptionTier(user.subscriptionTier)) {
      throw new Error(
        `You cannot login because you don't have an active subscription. Please upgrade your account to continue.`
      );
    }

    // Verify subscription tier with /auth/me endpoint - this is mandatory
    console.log("[Auth] Verifying subscription tier with /auth/me endpoint...");
    try {
      const meResponse = await ApiService.getCurrentUser(session.accessToken);

      console.log("[Auth] Full /auth/me response:", {
        status: meResponse.status,
        message: meResponse.message,
        hasData: !!meResponse.data,
        dataKeys: meResponse.data ? Object.keys(meResponse.data) : [],
      });

      const meUser = meResponse.data?.user || meResponse.data;

      if (!meUser) {
        console.error("[Auth] /auth/me response structure:", JSON.stringify(meResponse, null, 2));
        throw new Error("Failed to retrieve user data from /auth/me endpoint");
      }

      // Debug: Log subscription tier details
      console.log("[Auth] /auth/me user data:", {
        id: meUser.id,
        email: meUser.email,
        subscriptionTier: meUser.subscriptionTier,
        subscriptionTierType: typeof meUser.subscriptionTier,
        subscriptionTierLength: meUser.subscriptionTier?.length,
        subscriptionTierCharCodes: meUser.subscriptionTier ? meUser.subscriptionTier.split('').map((c: string) => c.charCodeAt(0)) : [],
      });

      const tierToValidate = meUser.subscriptionTier;
      console.log(`[Auth] Validating subscription tier: "${tierToValidate}"`);

      if (!this.isValidSubscriptionTier(tierToValidate)) {
        console.error(`[Auth] ❌ REJECTED: "${tierToValidate}" is not a valid subscription tier`);
        throw new Error(
          `You cannot login because you don't have an active subscription. Please upgrade your account to continue.`
        );
      }

      console.log("[Auth] ✅ Subscription tier verified successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Auth] Subscription tier verification failed:", errorMessage);
      throw new Error(
        errorMessage.includes("active subscription") || errorMessage.includes("don't have")
          ? errorMessage
          : `Failed to verify account access. ${errorMessage}`
      );
    }

    // Store in localStorage
    AuthService.saveSession(session);
    AuthService.saveUser(user);

    // Verify session was saved
    const savedSession = AuthService.getSession();
    if (!savedSession?.accessToken) {
      throw new Error("Failed to save session token");
    }

    console.log("Session saved successfully:", {
      hasAccessToken: !!savedSession.accessToken,
      expiresAt: savedSession.expiresAt,
    });

    return { user, session };
  }

  static saveSession(session: Session): void {
    try {
      storage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    } catch (error) {
      console.error("Failed to save session:", error);
    }
  }

  static saveUser(user: AuthUser): void {
    try {
      storage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
    } catch (error) {
      console.error("Failed to save user:", error);
    }
  }

  static getSession(): Session | null {
    try {
      const stored = storage.getItem(STORAGE_KEYS.session);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  static getUser(): AuthUser | null {
    try {
      const stored = storage.getItem(STORAGE_KEYS.user);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  static isSessionValid(): boolean {
    const session = this.getSession();
    if (!session) return false;

    const user = this.getUser();
    if (!user || !this.isValidSubscriptionTier(user.subscriptionTier)) {
      return false;
    }

    const now = Date.now();
    return now < session.expiresAt * 1000;
  }

  static async logout(): Promise<void> {
    const session = this.getSession();
    if (session) {
      try {
        await ApiService.logout(session.accessToken);
      } catch (error) {
        console.error("Failed to logout from API:", error);
      }
    }

    this.clearSession();
  }

  static clearSession(): void {
    try {
      storage.removeItem(STORAGE_KEYS.session);
      storage.removeItem(STORAGE_KEYS.user);
    } catch (error) {
      console.error("Failed to clear session:", error);
    }
  }

  static async refreshSession(): Promise<Session | null> {
    const session = this.getSession();
    if (!session) return null;

    try {
      const response = await ApiService.refreshToken(session.refreshToken);

      if (response.status !== "success") {
        this.clearSession();
        return null;
      }

      // Validate subscription tier from refresh response
      const refreshedUser = response.data?.user;
      if (refreshedUser && !this.isValidSubscriptionTier(refreshedUser.subscriptionTier)) {
        console.error("[Auth] User subscription tier became invalid during refresh, clearing session");
        this.clearSession();
        return null;
      }

      const newSession = response.data.session;
      this.saveSession(newSession);

      // Update user data if provided
      if (refreshedUser) {
        this.saveUser(refreshedUser);
      }

      return newSession;
    } catch (error) {
      console.error("Failed to refresh session:", error);
      this.clearSession();
      return null;
    }
  }
}
