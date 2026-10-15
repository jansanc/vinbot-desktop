import crypto from "crypto";
import http from "http";
import { shell } from "electron";
import { config } from "../config/config";

/**
 * Cloudflare Turnstile for the login the API checks it on (auth/turnstile.ts in
 * vinted-api).
 *
 * Done in the user's own browser, coming back to a listener on 127.0.0.1, the
 * way Google sign-in is (google-sign-in.ts). Cloudflare fails the challenge
 * in an app window with error 600010, whatever the page or user agent: first
 * with its requests intercepted, then as a page loaded as data under the web
 * app's origin, then with a plain Chrome user agent on top.
 *
 * config.turnstile.pageUrl is the web app's /desktop-turnstile, which runs the
 * check and sends the browser back to `redirect` with the token and the
 * `state` it was given. That page only accepts a 127.0.0.1 redirect on
 * CALLBACK_PATH.
 */

// Time to notice the tab, and for a visitor who does get the checkbox
const FLOW_TIMEOUT_MS = 3 * 60 * 1000;
const CALLBACK_PATH = "/turnstile";

/**
 * A token for one API call (a token works once). No token when Turnstile is
 * off (no site key), the user left the check ("abandoned") or it could not be
 * done ("failed"). The call goes ahead anyway, as the API may not ask for
 * one; when it does it answers CAPTCHA_REQUIRED, and `failed` lets the caller
 * say the check failed instead of that it was skipped.
 */
export interface TurnstileResult {
  token?: string;
  failed?: "abandoned" | "failed";
}

let abandonCurrent: (() => void) | null = null;

// The tab the browser is left on; the app doesn't know the user's language here
const DONE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Vinbot Authenticator</title>
<style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:1rem}h1{font-size:1.25rem;font-weight:600}p{opacity:.7}</style>
</head><body><div><h1>&#10003;</h1><p>You can close this tab and go back to Vinbot Authenticator.</p></div></body></html>`;

export async function getTurnstileToken(): Promise<TurnstileResult> {
  if (!config.turnstile.siteKey) return {};

  // One at a time: signing in again gives up on the tab left open
  abandonCurrent?.();

  const state = crypto.randomBytes(24).toString("base64url");
  const server = http.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    console.error("[Turnstile] Could not listen for the browser:", error);
    return { failed: "failed" };
  }
  const { port } = server.address() as { port: number };
  const redirect = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  let abandon: (() => void) | null = null;
  try {
    return await new Promise<TurnstileResult>((resolve) => {
      let settled = false;
      const finish = (result: TurnstileResult, reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (reason) console.warn(`[Turnstile] No token: ${reason}`);
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ failed: "abandoned" }, "timed out waiting for the browser"),
        FLOW_TIMEOUT_MS
      );
      abandon = abandonCurrent = () => finish({ failed: "abandoned" }, "a newer sign-in started");

      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirect);
        const token = url.searchParams.get("token");
        // Anything else on this port, or a token for another sign-in
        if (
          req.method !== "GET" ||
          url.pathname !== CALLBACK_PATH ||
          !token ||
          url.searchParams.get("state") !== state
        ) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          // So close() below is not held up by a kept-alive browser connection
          Connection: "close",
        });
        res.end(DONE_PAGE);
        finish({ token });
      });

      const start = new URL(config.turnstile.pageUrl);
      start.searchParams.set("redirect", redirect);
      start.searchParams.set("state", state);
      shell.openExternal(start.toString()).catch((error) =>
        finish(
          { failed: "failed" },
          `could not open the browser: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    });
  } finally {
    // A newer sign-in may have replaced it already
    if (abandonCurrent === abandon) abandonCurrent = null;
    server.close();
  }
}
