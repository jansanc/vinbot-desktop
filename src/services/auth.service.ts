import { ApiBridge as ApiService } from "./api.bridge";
import { config } from "../config/config";
import { storage } from "../config/storage";

/**
 * The renderer's view of the session: only when it expires. The tokens stay in
 * the main process (encrypted on disk via safeStorage) and main attaches them
 * to every API call, so they are never in localStorage in the clear.
 */
export interface Session {
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
  session?: Session;
}

const STORAGE_KEYS = config.storage.keys;

const NO_SUBSCRIPTION_MESSAGE =
  "You cannot login because you don't have an active subscription. Please upgrade your account to continue.";

/** The account has no plan that allows using the app. */
export class SubscriptionError extends Error {
  constructor(message = NO_SUBSCRIPTION_MESSAGE) {
    super(message);
    this.name = "SubscriptionError";
  }
}
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

    if (!session?.expiresAt) {
      throw new Error("Server did not return a session");
    }

    // /auth/me is the source of truth for the plan: the user saved (and shown
    // in the header) is the one it returns, not the login response's copy.
    let verifiedUser: AuthUser;
    try {
      verifiedUser = await AuthService.fetchCurrentUser();
    } catch (error) {
      if (error instanceof SubscriptionError) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Auth] Subscription tier verification failed:", errorMessage);
      throw new Error(`Failed to verify account access. ${errorMessage}`);
    }

    AuthService.saveSession(session);
    console.log("Session saved successfully:", { expiresAt: session.expiresAt });

    return { user: verifiedUser, session };
  }

  /**
   * The current user, plan included, straight from /auth/me, saved over the
   * cached copy. The plan changes on the server (upgrades, downgrades,
   * cancellations) while a session lives on for weeks through refreshes, and
   * the refresh response carries no user, so the cache alone went stale: an
   * account upgraded to Enterprise kept showing the plan it logged in with.
   * Throws SubscriptionError when the plan doesn't allow using the app.
   */
  static async fetchCurrentUser(): Promise<AuthUser> {
    const meResponse = await ApiService.getCurrentUser();
    const meUser: AuthUser | undefined = meResponse?.data?.user || meResponse?.data;
    if (!meUser?.id) {
      throw new Error("Failed to retrieve user data from /auth/me endpoint");
    }

    console.log(`[Auth] /auth/me subscription tier: "${meUser.subscriptionTier}"`);
    if (!AuthService.isValidSubscriptionTier(meUser.subscriptionTier)) {
      throw new SubscriptionError();
    }

    AuthService.saveUser(meUser);
    return meUser;
  }

  static saveSession(session: Session): void {
    try {
      // Only the expiry, whatever the caller passed.
      const { expiresIn, expiresAt } = session;
      storage.setItem(STORAGE_KEYS.session, JSON.stringify({ expiresIn, expiresAt }));
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
      if (!stored) return null;
      const session = JSON.parse(stored);
      // Sessions saved by older versions carried the tokens; drop them.
      if ("accessToken" in session || "refreshToken" in session) {
        AuthService.saveSession(session);
      }
      return { expiresIn: session.expiresIn, expiresAt: session.expiresAt };
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

  /**
   * Main holds the tokens. Without them (logged out elsewhere, or no
   * safeStorage backend to keep them across a restart) the renderer's copy of
   * the session is worthless.
   */
  static async hasMainSession(): Promise<boolean> {
    try {
      const result = await window.electronAPI.auth.getStoredSession();
      return result.ok && !!result.data?.hasSession;
    } catch {
      return false;
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
    // expiresAt is in seconds from server, so multiply by 1000 to get milliseconds
    // Add 60 second buffer to refresh before actual expiry
    const expirationTime = session.expiresAt * 1000;
    const bufferTime = 60 * 1000; // 60 second buffer

    console.log("[Auth] Session validity check:", {
      now: new Date(now).toISOString(),
      expiresAt: new Date(expirationTime).toISOString(),
      isValid: now < (expirationTime - bufferTime),
      timeUntilExpiry: Math.round((expirationTime - now) / 1000) + "s",
    });

    return now < (expirationTime - bufferTime);
  }

  static async logout(): Promise<void> {
    const session = this.getSession();
    if (session) {
      try {
        await ApiService.logout();
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
      const response = await ApiService.refreshToken();

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
