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

export class AuthService {
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

      const newSession = response.data.session;
      this.saveSession(newSession);
      return newSession;
    } catch (error) {
      console.error("Failed to refresh session:", error);
      this.clearSession();
      return null;
    }
  }
}
