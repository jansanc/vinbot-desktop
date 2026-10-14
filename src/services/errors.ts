/**
 * Shared error types for API calls.
 *
 * Kept in its own module so the main-process HTTP client (api.service) and the
 * renderer-side IPC bridge (api.bridge) throw the *same* class: the error
 * crosses the IPC boundary as a plain envelope and is rebuilt on the other
 * side, and `instanceof` must still hold for its consumers.
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * A refused sign-in, with what the UI translates on: the API's error `code`
 * (EMAIL_NOT_CONFIRMED, LOGIN_RATE_LIMITED, ...; its `message` is English and
 * only a fallback) and the HTTP status. Google sign-in failures in main use
 * the same class with GOOGLE_* codes.
 */
export class CodedError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = "CodedError";
  }
}
