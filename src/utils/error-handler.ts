import { UnauthorizedError } from "../services/api.service";

export type ErrorSeverity = "info" | "warning" | "error" | "critical";

export interface AppError {
  message: string;
  severity: ErrorSeverity;
  code?: string;
  isAuthError: boolean;
  shouldRedirectToLogin: boolean;
}

export function parseError(err: unknown): AppError {
  // Handle UnauthorizedError
  if (err instanceof UnauthorizedError) {
    return {
      message: "Your session has expired. Please log in again.",
      severity: "critical",
      code: "UNAUTHORIZED",
      isAuthError: true,
      shouldRedirectToLogin: true,
    };
  }

  // Handle standard Error
  if (err instanceof Error) {
    const message = err.message.toLowerCase();

    // Detect 401 in error message
    if (message.includes("401") || message.includes("not authenticated")) {
      return {
        message: "Your session has expired. Please log in again.",
        severity: "critical",
        code: "UNAUTHORIZED",
        isAuthError: true,
        shouldRedirectToLogin: true,
      };
    }

    // Detect network errors
    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return {
        message: "Network error. Please check your connection and try again.",
        severity: "error",
        code: "NETWORK_ERROR",
        isAuthError: false,
        shouldRedirectToLogin: false,
      };
    }

    return {
      message: err.message || "An error occurred. Please try again.",
      severity: "error",
      code: "UNKNOWN_ERROR",
      isAuthError: false,
      shouldRedirectToLogin: false,
    };
  }

  // Handle unknown errors
  return {
    message: "An unexpected error occurred. Please try again.",
    severity: "error",
    code: "UNKNOWN_ERROR",
    isAuthError: false,
    shouldRedirectToLogin: false,
  };
}

export function logError(err: unknown, context?: string): void {
  const appError = parseError(err);
  const timestamp = new Date().toISOString();

  console.error(
    `[${timestamp}] ${appError.severity.toUpperCase()}: ${context ? `[${context}] ` : ""}${appError.message}`,
    {
      code: appError.code,
      isAuthError: appError.isAuthError,
      originalError: err,
    }
  );
}
