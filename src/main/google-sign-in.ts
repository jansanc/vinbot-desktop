import crypto from "crypto";
import http from "http";
import { shell } from "electron";
import { config } from "../config/config";

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

/** What the API's ?error= means, for the login form. */
const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  unavailable: "Google sign-in is not available right now.",
  expired: "The Google sign-in took too long. Please try again.",
  failed: "Google sign-in failed. Please try again.",
};

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

function page(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:1rem}h1{font-size:1.25rem;font-weight:600}p{opacity:.7}</style>
</head><body><div><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

/**
 * Opens the browser on the API's Google sign-in and waits for it to come back.
 * Resolves with the code and the verifier to redeem it with.
 */
export async function runGoogleSignIn(): Promise<{ code: string; codeVerifier: string }> {
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
      const timer = setTimeout(
        () => reject(new Error(ERROR_MESSAGES.expired)),
        FLOW_TIMEOUT_MS
      );
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
          res.end(page("Signed in", "You can close this tab and go back to Vinbot Authenticator."));
          clearTimeout(timer);
          resolve({ code, codeVerifier });
        } else {
          const message = ERROR_MESSAGES[error ?? ""] ?? ERROR_MESSAGES.failed;
          res.end(page("Sign-in did not finish", `${message} Go back to Vinbot Authenticator to try again.`));
          clearTimeout(timer);
          reject(new Error(message));
        }
      });

      const start = new URL(`${config.api.baseUrl}${config.api.endpoints.auth.googleStart}`);
      start.searchParams.set("desktop_redirect", redirect);
      start.searchParams.set("code_challenge", codeChallenge);
      shell.openExternal(start.toString()).catch((error) => {
        clearTimeout(timer);
        reject(new Error(`Could not open the browser: ${error instanceof Error ? error.message : String(error)}`));
      });
    });
  } finally {
    // A newer sign-in may have replaced it already
    if (cancelCurrent === cancel) cancelCurrent = null;
    // Stops listening; the page already sent finishes on its own
    server.close();
  }
}
