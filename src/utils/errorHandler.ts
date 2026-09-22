/**
 * Error Handler Utility
 * Provides error classification, logging, and user-friendly messages
 */

export interface AppError {
  code: string;
  message: string;
  userMessage: string;
  severity: "info" | "warning" | "error" | "critical";
  details?: Record<string, unknown>;
  timestamp: string;
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "AUTH_ERROR"
  | "SESSION_ERROR"
  | "HEALTH_CHECK_ERROR"
  | "UPLOAD_ERROR"
  | "BROWSER_ERROR"
  | "TIMEOUT_ERROR"
  | "API_ERROR"
  | "UNKNOWN_ERROR";

export class ErrorHandler {
  private static ERROR_MESSAGES: Record<ErrorCode, { userMessage: string; severity: AppError["severity"] }> = {
    VALIDATION_ERROR: {
      userMessage: "Please check your input and try again",
      severity: "warning",
    },
    NETWORK_ERROR: {
      userMessage: "Network connection error. Please check your internet and try again",
      severity: "error",
    },
    AUTH_ERROR: {
      userMessage: "Authentication failed. Please check your credentials",
      severity: "error",
    },
    SESSION_ERROR: {
      userMessage: "Session error. Your session may have expired",
      severity: "error",
    },
    HEALTH_CHECK_ERROR: {
      userMessage: "Session health check failed. The session may not be valid",
      severity: "warning",
    },
    UPLOAD_ERROR: {
      userMessage: "Failed to upload. Please try again",
      severity: "error",
    },
    BROWSER_ERROR: {
      userMessage: "Browser operation failed. Make sure the browser is installed",
      severity: "error",
    },
    TIMEOUT_ERROR: {
      userMessage: "Operation timed out. Please try again",
      severity: "warning",
    },
    API_ERROR: {
      userMessage: "Server error. Please try again later",
      severity: "error",
    },
    UNKNOWN_ERROR: {
      userMessage: "An unexpected error occurred. Please try again",
      severity: "error",
    },
  };

  static classify(error: unknown): ErrorCode {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
        return "NETWORK_ERROR";
      }
      if (message.includes("auth") || message.includes("unauthorized") || message.includes("401")) {
        return "AUTH_ERROR";
      }
      if (message.includes("session") || message.includes("cookie")) {
        return "SESSION_ERROR";
      }
      if (message.includes("health")) {
        return "HEALTH_CHECK_ERROR";
      }
      if (message.includes("upload")) {
        return "UPLOAD_ERROR";
      }
      if (message.includes("browser") || message.includes("chrome") || message.includes("firefox")) {
        return "BROWSER_ERROR";
      }
      if (message.includes("timeout")) {
        return "TIMEOUT_ERROR";
      }
      if (message.includes("400") || message.includes("validation")) {
        return "VALIDATION_ERROR";
      }
      if (message.includes("500") || message.includes("api")) {
        return "API_ERROR";
      }
    }

    return "UNKNOWN_ERROR";
  }

  /**
   * The API answers a rejected request with a message written for the user
   * ("This browser profile is too large to upload. Clear the browser cache..."),
   * and ApiService carries it in the thrown error as "... (413): <message>".
   * Replacing that with a generic "Failed to upload. Please try again" throws
   * away the only part that says what to do, so it is kept when present.
   */
  private static extractServerMessage(error: unknown): string | null {
    if (!(error instanceof Error)) return null;
    const match = error.message.match(/\((?:[45]\d{2})\):\s*(.+)$/s);
    const serverMessage = match?.[1]?.trim();
    if (!serverMessage) return null;
    // A bare status text ("Internal Server Error") says no more than the
    // generic message does.
    if (/^(internal server error|bad gateway|service unavailable)$/i.test(serverMessage)) {
      return null;
    }
    return serverMessage;
  }

  static handle(error: unknown): AppError {
    const code = this.classify(error);
    const { userMessage, severity } = this.ERROR_MESSAGES[code];
    const details = error instanceof Error ? { originalError: error.message } : { error: String(error) };

    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      userMessage: this.extractServerMessage(error) || userMessage,
      severity,
      details,
      timestamp: new Date().toISOString(),
    };
  }

  static formatErrorMessage(error: AppError | unknown): string {
    if (error && typeof error === "object" && "userMessage" in error) {
      return (error as AppError).userMessage;
    }
    return "An unexpected error occurred";
  }

  static log(error: AppError, context?: string): void {
    const logLevel = error.severity === "critical" ? "error" : error.severity === "error" ? "error" : "warn";
    console.log(`[${error.severity.toUpperCase()}] ${context ? `[${context}] ` : ""}${error.message}`, error.details);
  }

  static createError(code: ErrorCode, message: string, details?: Record<string, unknown>): AppError {
    const { userMessage, severity } = this.ERROR_MESSAGES[code];

    return {
      code,
      message,
      userMessage,
      severity,
      details,
      timestamp: new Date().toISOString(),
    };
  }
}
