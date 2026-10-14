import { CodedError, UnauthorizedError } from "../services/errors";
import { SubscriptionError } from "../services/auth.service";
import type { MessageKey } from "./messages";

/**
 * What to tell the user about a failed sign-in, as a message key. The API's
 * messages are English, so, as the web app does, only its codes and status
 * are used; anything unrecognised gets the generic `fallback`.
 */
const BY_CODE: Record<string, MessageKey> = {
  EMAIL_NOT_CONFIRMED: "login.emailNotConfirmed",
  LOGIN_RATE_LIMITED: "login.loginRateLimited",
  CAPTCHA_REQUIRED: "login.captchaRequired",
  CAPTCHA_FAILED: "login.captchaFailed",
  VERIFY_FAILED: "login.verifyFailed",
  // The code from the loopback was used, expired or not ours
  OAUTH_CODE_INVALID: "google.expired",
  GOOGLE_CANCELLED: "google.cancelled",
  GOOGLE_UNAVAILABLE: "google.unavailable",
  GOOGLE_EXPIRED: "google.expired",
  GOOGLE_FAILED: "google.failed",
  GOOGLE_BROWSER: "google.browserFailed",
};

export function signInErrorKey(error: unknown, fallback: MessageKey): MessageKey {
  if (error instanceof SubscriptionError) return "login.noSubscription";
  if (error instanceof UnauthorizedError) return "login.sessionExpired";
  if (error instanceof CodedError) {
    if (error.code && BY_CODE[error.code]) return BY_CODE[error.code];
    if (error.status === 401) return "login.invalidCredentials";
  }
  return fallback;
}
