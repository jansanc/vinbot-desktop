import { ApiService, LoginResponse } from "./api.service";

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

const STORAGE_KEYS = {
  SESSION: "vinted_session",
  USER: "vinted_user",
};

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

    // Store in localStorage
    this.saveSession(session);
    this.saveUser(user);

    return { user, session };
  }

  static saveSession(session: Session): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    } catch (error) {
      console.error("Failed to save session:", error);
    }
  }

  static saveUser(user: AuthUser): void {
    try {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    } catch (error) {
      console.error("Failed to save user:", error);
    }
  }

  static getSession(): Session | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SESSION);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  static getUser(): AuthUser | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.USER);
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
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      localStorage.removeItem(STORAGE_KEYS.USER);
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
