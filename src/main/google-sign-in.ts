import crypto from "crypto";
import http from "http";
import { shell } from "electron";
import { config } from "../config/config";
import { CodedError } from "../services/errors";
import { DEFAULT_LOCALE, translate, type Locale } from "../i18n/messages";

/**
 * Sign in with Google the way RFC 8252 says a native app should: in the user's
 * own browser, never in an app window (Google refuses embedded ones), coming
 * back to a listener on 127.0.0.1.
 *
 * The API runs the OAuth exchange (auth/oauth.ts in vinted-api). Started with
 * desktop_redirect and the challenge of a PKCE pair kept here, its callback
 * hands GoTrue's code to this listener instead of setting cookies, and the
 * code is worth nothing without the verifier that never leaves this process.
 */

// The API keeps its side of the flow for 15 minutes
const FLOW_TIMEOUT_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/callback";

/** The API's ?error= values; anything else counts as "failed". */
const API_ERRORS = ["cancelled", "unavailable", "expired", "failed"] as const;
type GoogleError = (typeof API_ERRORS)[number] | "browser";

/** The renderer translates on the code (GOOGLE_CANCELLED, ...); the message is a log fallback. */
function googleError(kind: GoogleError, detail?: string): CodedError {
  return new CodedError(detail ?? `Google sign-in: ${kind}`, `GOOGLE_${kind.toUpperCase()}`);
}

export class GoogleSignInCancelled extends Error {
  constructor() {
    super("Google sign-in was cancelled.");
    this.name = "GoogleSignInCancelled";
  }
}

let cancelCurrent: (() => void) | null = null;

/** Stops a sign-in waiting on the browser; it rejects with GoogleSignInCancelled. */
export function cancelGoogleSignIn(): void {
  cancelCurrent?.();
}

function page(locale: Locale, title: string, message: string): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${title}</title>
<style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:1rem}h1{font-size:1.25rem;font-weight:600}p{opacity:.7}</style>
</head><body><div><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

/**
 * Opens the browser on the API's Google sign-in and waits for it to come back.
 * Resolves with the code and the verifier to redeem it with. `locale` is the
 * app's language: for the page the browser lands on, and for the API (a new
 * account's emails).
 */
export async function runGoogleSignIn(
  locale: Locale = DEFAULT_LOCALE
): Promise<{ code: string; codeVerifier: string }> {
  // One at a time: a second click starts over
  cancelGoogleSignIn();

  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as { port: number };
  const redirect = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  let cancel: (() => void) | null = null;
  try {
    return await new Promise<{ code: string; codeVerifier: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(googleError("expired")), FLOW_TIMEOUT_MS);
      cancel = cancelCurrent = () => {
        clearTimeout(timer);
        reject(new GoogleSignInCancelled());
      };

      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirect);
        if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
          res.writeHead(404).end();
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          // So close() below is not held up by a kept-alive browser connection
          Connection: "close",
        });
        if (code) {
          res.end(
            page(locale, translate(locale, "google.pageSignedInTitle"), translate(locale, "google.pageSignedInBody"))
          );
          clearTimeout(timer);
          resolve({ code, codeVerifier });
        } else {
          const kind: GoogleError = (API_ERRORS as readonly string[]).includes(error ?? "")
            ? (error as GoogleError)
            : "failed";
          res.end(
            page(
              locale,
              translate(locale, "google.pageFailedTitle"),
              `${translate(locale, `google.${kind}` as "google.failed")} ${translate(locale, "google.pageFailedBody")}`
            )
          );
          clearTimeout(timer);
          reject(googleError(kind));
        }
      });

      const start = new URL(`${config.api.baseUrl}${config.api.endpoints.auth.googleStart}`);
      start.searchParams.set("desktop_redirect", redirect);
      start.searchParams.set("code_challenge", codeChallenge);
      start.searchParams.set("locale", locale);
      shell.openExternal(start.toString()).catch((error) => {
        clearTimeout(timer);
        reject(googleError("browser", `Could not open the browser: ${error instanceof Error ? error.message : String(error)}`));
      });
    });
  } finally {
    // A newer sign-in may have replaced it already
    if (cancelCurrent === cancel) cancelCurrent = null;
    // Stops listening; the page already sent finishes on its own
    server.close();
  }
}
