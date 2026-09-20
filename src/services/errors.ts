/**
 * Shared error types for API calls.
 *
 * Kept in its own module so the main-process HTTP client (api.service) and the
 * renderer-side IPC bridge (api.bridge) throw the *same* class: the error
 * crosses the IPC boundary as a plain envelope and is rebuilt on the other
 * side, and `instanceof` must still hold for consumers like
 * `utils/error-handler`.
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}
