const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:3001";

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

export class ApiService {
  static async login(credentials: LoginCredentials): Promise<LoginResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.data?.message || errorData.message || "Login failed"
        );
      }

      return await response.json();
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }

  static async refreshToken(refreshToken: string): Promise<LoginResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error("Token refresh failed");
      }

      return await response.json();
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }

  static async getCurrentUser(accessToken: string): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch user");
      }

      return await response.json();
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }

  static async logout(accessToken: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Logout failed");
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error("Network error");
    }
  }
}
