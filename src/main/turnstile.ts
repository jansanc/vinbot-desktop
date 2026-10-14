import { BrowserWindow, session, type Session } from "electron";
import { config } from "../config/config";

/**
 * Cloudflare Turnstile for the login the API checks it on (auth/turnstile.ts in
 * vinted-api).
 *
 * The widget only runs on a hostname the site key allows, and the app's own
 * page is file://, which Cloudflare refuses. So the check gets a window of its
 * own, in a separate in-memory session, showing the page below loaded as data
 * with config.turnstile.pageUrl (on the web app's hostname) as its origin.
 * Nothing is fetched from that URL, and Cloudflare's script and challenge go
 * over the browser's own network stack untouched: intercepting them (an
 * earlier version) made real challenges fail with error 600010.
 *
 * The window stays hidden: "interaction-only" passes nearly everyone in the
 * background, and it is shown only when Cloudflare wants a click. It has no
 * preload; main reads the outcome by awaiting promises the page exposes.
 */

// Same as the web app: long enough for a visitor who does get the checkbox
const TOKEN_WAIT_MS = 30_000;
const INTERACTION_WAIT_MS = 120_000;

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";

function pageHtml(siteKey: string): string {
  const key = JSON.stringify(siteKey).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Security check</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; background: Canvas; }
</style>
</head>
<body>
<div id="widget"></div>
<script>
  let settle, markInteractive;
  // Read by main with executeJavaScript, which waits for a promise to settle
  window.turnstileResult = new Promise((resolve) => (settle = resolve));
  window.turnstileInteractive = new Promise((resolve) => (markInteractive = resolve));
  window.onTurnstileLoad = () => {
    turnstile.render("#widget", {
      sitekey: ${key},
      appearance: "interaction-only",
      callback: (token) => settle({ token }),
      "error-callback": (code) => { settle({ error: String(code) }); return true; },
      "timeout-callback": () => settle({ error: "timeout" }),
      "before-interactive-callback": () => markInteractive(),
    });
  };
</script>
<script src="${SCRIPT_SRC}" async onerror="settle({ error: 'script failed to load' })"></script>
</body>
</html>`;
}

let turnstileSession: Session | null = null;

function getTurnstileSession(): Session {
  if (turnstileSession) return turnstileSession;
  const ses = session.fromPartition("turnstile");

  // Nothing the check needs; matches the default session
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  turnstileSession = ses;
  return ses;
}

/**
 * A token for one API call (a token works once). Undefined when Turnstile is
 * off (no site key) or the check failed or was closed; the API then answers
 * CAPTCHA_REQUIRED, which the login form shows.
 */
export async function getTurnstileToken(parent?: BrowserWindow | null): Promise<string | undefined> {
  if (!config.turnstile.siteKey) return undefined;

  const win = new BrowserWindow({
    parent: parent ?? undefined,
    modal: Boolean(parent),
    show: false,
    width: 380,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "Security check",
    autoHideMenuBar: true,
    webPreferences: {
      session: getTurnstileSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Hidden windows are throttled, which would stall the background check
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);

  let timer: NodeJS.Timeout | undefined;
  try {
    // The page is ours, but its origin is pageUrl's: Turnstile sees an allowed
    // hostname, and nothing is fetched from it or intercepted
    const html = Buffer.from(pageHtml(config.turnstile.siteKey)).toString("base64");
    await win.loadURL(`data:text/html;charset=utf-8;base64,${html}`, {
      baseURLForDataURL: config.turnstile.pageUrl,
    });

    return await new Promise<string | undefined>((resolve) => {
      let settled = false;
      const finish = (token: string | undefined) => {
        settled = true;
        resolve(token);
      };
      const giveUp = (reason: string) => {
        if (settled) return;
        console.warn(`[Turnstile] No token: ${reason}`);
        finish(undefined);
      };
      timer = setTimeout(() => giveUp("timed out"), TOKEN_WAIT_MS);
      win.on("closed", () => giveUp("window closed"));

      win.webContents
        .executeJavaScript("window.turnstileInteractive")
        .then(() => {
          if (settled || win.isDestroyed()) return;
          clearTimeout(timer);
          timer = setTimeout(() => giveUp("timed out waiting for the user"), INTERACTION_WAIT_MS);
          win.show();
        })
        .catch(() => {});

      win.webContents
        .executeJavaScript("window.turnstileResult")
        .then((result: { token?: string; error?: string }) => {
          if (result?.token) finish(result.token);
          else giveUp(`Cloudflare error ${result?.error ?? "unknown"}`);
        })
        .catch((error) => giveUp(error instanceof Error ? error.message : String(error)));
    });
  } catch (error) {
    console.error("[Turnstile] Check page failed:", error);
    return undefined;
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}
