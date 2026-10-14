import path from "path";
import os from "os";
import { execFile, spawn, spawnSync, ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from "fs";
import * as tar from "tar";
import { archiveNamePart, includeInProfileArchive } from "../profile/profileArchive";
import {
  hasCompleteVintedLogin,
  readVintedCookies,
  vintedLoginState,
  type VintedCookie,
  type VintedLoginState,
} from "./firefoxCookies";

export type { VintedCookie } from "./firefoxCookies";

/** Where the login is at, for the progress the user sees. */
export type LoginStatus = "waiting-for-login" | "logged-in" | "saving";

export interface InteractiveLoginOptions {
  url: string;
  profileName: string;
  /** Seconds the user has to log in. */
  timeout?: number;
  onStatus?: (status: LoginStatus) => void;
}

/**
 * Why a login ended without a session, for the window to explain in the
 * user's language. Anything else is reported with its (English) message.
 */
export type LoginFlowErrorCode = "LOGIN_TIMEOUT" | "LOGIN_CANCELLED" | "FIREFOX_NOT_FOUND";

export class LoginFlowError extends Error {
  constructor(public readonly code: LoginFlowErrorCode, message: string) {
    super(message);
    this.name = "LoginFlowError";
  }
}

export interface InteractiveLoginResult {
  profile_name: string;
  profile_path: string;
  url: string;
  profile_archive_path: string;
  profile_archive_size: number;
  extracted_at: number;
  loginDuration: number;
  compressed_at: number;
  /**
   * What the Vinted cookies said when the window closed. Informational only:
   * the profile is archived and uploaded whatever this says.
   */
  vinted_login: VintedLoginState;
  /**
   * The Vinted cookies from the closed profile (see readVintedCookies), for
   * the backend's session row. Empty when they couldn't be read.
   */
  vinted_cookies: VintedCookie[];
}

/** Size of the login window, in logical (DPI-scaled) pixels: a small window,
 * just wide enough for Vinted's login form and the Google/Apple sign-in popups. */
const LOGIN_WINDOW_SIZE = { width: 520, height: 720 };

/** How often the macOS window watch checks whether the login window is still open. */
const MAC_WINDOW_POLL_MS = 1000;

/** How often the profile's cookies are checked for a finished login. */
const LOGIN_POLL_MS = 1500;

/**
 * How long the window stays open once the login is seen. Vinted sets the
 * session tokens before it finishes redirecting, and the page may still be
 * storing the rest of what a logged-in visit has.
 */
const LOGGED_IN_SETTLE_MS = 2500;

/**
 * JXA (osascript -l JavaScript): how many normal windows (layer 0) the process
 * with pid argv[0] has. CGWindowListCopyWindowInfo gives owner pids and layers
 * without the Screen Recording permission (only window titles need that).
 * kCGWindowListOptionAll, not OnScreenOnly: a minimized window, or one on
 * another Space, is still open.
 */
const MAC_WINDOW_COUNT_SCRIPT = `
ObjC.import("CoreGraphics");
function run(argv) {
  const pid = Number(argv[0]);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID)
  )) || [];
  return list.filter(w =>
    w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 &&
    w.kCGWindowBounds && w.kCGWindowBounds.Width > 100 && w.kCGWindowBounds.Height > 100
  ).length;
}`;

/** JXA: ask the app with pid argv[0] to quit, exactly as ⌘Q would. */
const MAC_QUIT_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  return app.isNil() ? false : app.terminate;
}`;

export class InteractiveSessionExtractor {
  private tempProfileDir: string | null = null;
  /** Set while the login window is open: closes it and ends the login unsaved. */
  private cancelLogin: (() => void) | null = null;

  /** Close the login window without saving. Nothing happens once Firefox has closed. */
  cancel(): void {
    this.cancelLogin?.();
  }

  /**
   * Find the Firefox executable. The interactive login only ever launches
   * Firefox; Chrome and Edge are never started by this app.
   */
  private findFirefoxPath(): string {
    const paths: string[] = [];
    if (process.platform === "win32") {
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
      paths.push(
        path.join(programFiles, "Mozilla Firefox", "firefox.exe"),
        path.join(programFilesX86, "Mozilla Firefox", "firefox.exe"),
        // Installed for the current user only
        path.join(process.env.LOCALAPPDATA || "", "Mozilla Firefox", "firefox.exe")
      );
    } else if (process.platform === "darwin") {
      // The binary inside the bundle, not `open -a Firefox`: that returns at
      // once, and it's this process's exit that says the login is over.
      const inBundle = (app: string) => path.join(app, "Contents", "MacOS", "firefox");
      paths.push(
        inBundle("/Applications/Firefox.app"),
        inBundle(path.join(os.homedir(), "Applications", "Firefox.app"))
      );
      // Anywhere else Spotlight knows of (a renamed app, another folder)
      const found = spawnSync("mdfind", ["kMDItemCFBundleIdentifier == 'org.mozilla.firefox'"], {
        encoding: "utf8",
        timeout: 5000,
      });
      for (const app of (found.stdout || "").split("\n").filter(Boolean)) paths.push(inBundle(app));
    } else {
      paths.push("/usr/bin/firefox", "/usr/local/bin/firefox", "/snap/bin/firefox");
    }

    for (const p of paths) {
      if (existsSync(p)) {
        return p;
      }
    }

    throw new LoginFlowError(
      "FIREFOX_NOT_FOUND",
      process.platform === "darwin"
        ? "Could not find Firefox. Please install Firefox in your Applications folder and try again."
        : "Could not find Firefox. Please install Firefox and try again."
    );
  }

  /**
   * Make the fresh profile open as a bare login window rather than a browser:
   * no welcome/onboarding/privacy-notice tabs, no tab strip, no address bar.
   *
   * user.js is read on every start and applied over prefs.js. The UI is hidden
   * with userChrome.css, which Firefox only loads when
   * toolkit.legacyUserProfileCustomizations.stylesheets is on.
   */
  private prepareFirefoxProfile(profilePath: string): void {
    const now = Date.now();
    const prefs: Record<string, string | number | boolean> = {
      // First-run and upgrade pages
      "browser.aboutwelcome.enabled": false,
      "browser.startup.homepage_override.mstone": "ignore",
      "startup.homepage_welcome_url": "",
      "startup.homepage_welcome_url.additional": "",
      "startup.homepage_override_url": "",
      "browser.startup.firstrunSkipsHomepage": true,
      "browser.startup.upgradeDialog.enabled": false,
      "browser.shell.checkDefaultBrowser": false,
      "browser.messaging-system.whatsNewPanel.enabled": false,
      "browser.uitour.enabled": false,
      // The first-run "Welcome / by continuing you accept the Terms of Use"
      // modal shown over the page, and the later Terms of Use infobar: mark
      // the terms as already accepted so neither has anything to ask
      "browser.preonboarding.enabled": false,
      "termsofuse.bypassNotification": true,
      "termsofuse.acceptedVersion": 999,
      "termsofuse.acceptedDate": String(now),
      // The "Firefox Privacy Notice" tab and "Firefox automatically sends some
      // data to Mozilla" infobar
      "datareporting.policy.dataSubmissionPolicyBypassNotification": true,
      "datareporting.policy.dataSubmissionPolicyAcceptedVersion": 999,
      "datareporting.policy.dataSubmissionPolicyNotifiedTime": String(now),
      "datareporting.policy.firstRunURL": "",
      "datareporting.healthreport.uploadEnabled": false,
      "toolkit.telemetry.reportingpolicy.firstRun": false,
      // Recommendations, surveys, studies and other in-window messages
      "browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons": false,
      "browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features": false,
      "messaging-system.rsexperimentloader.enabled": false,
      "messaging-system.askForFeedback": false,
      "app.normandy.enabled": false,
      "app.shield.optoutstudies.enabled": false,
      "browser.disableResetPrompt": true,
      "browser.translations.automaticallyPopup": false,
      "browser.translations.enable": false,
      "app.update.auto": false,
      "app.update.doorhanger": false,
      "app.update.badgeWaitTime": 999999999,
      // Keep everything in the one window, and don't nag on close
      "browser.link.open_newwindow": 1,
      "browser.tabs.warnOnClose": false,
      "browser.warnOnQuit": false,
      "browser.tabs.firefox-view": false,
      // The save-password doorhanger anchors to the hidden address bar
      "signon.rememberSignons": false,
      // Window chrome: native title bar (so there's a close button with the
      // tab strip hidden), and let userChrome.css hide the rest
      "browser.tabs.inTitlebar": 0,
      "browser.toolbars.bookmarks.visibility": "never",
      "toolkit.legacyUserProfileCustomizations.stylesheets": true,
    };

    const userJs = Object.entries(prefs)
      .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join("\n");
    writeFileSync(path.join(profilePath, "user.js"), userJs + "\n");

    // Window size and position. Firefox restores the main window from
    // xulstore.json, including on a profile's first start; without it a new
    // profile opens at whatever size Firefox guesses from the screen.
    // Capped to the screen, in case a small or heavily scaled display (e.g. 1298x768
    // logical at 222%) has less room than LOGIN_WINDOW_SIZE.
    const workArea = this.primaryWorkArea();
    const width = Math.min(LOGIN_WINDOW_SIZE.width, workArea?.width ?? Infinity);
    const height = Math.min(LOGIN_WINDOW_SIZE.height, workArea?.height ?? Infinity);
    const mainWindow: Record<string, string> = {
      width: String(width),
      height: String(height),
      sizemode: "normal",
    };
    if (workArea) {
      // Centred. On Windows Firefox reads the size in logical pixels but the
      // position in physical ones, hence the scale factor on screenX/screenY
      // only. macOS uses points (logical) for both.
      const scaleFactor = process.platform === "win32" ? workArea.scaleFactor : 1;
      mainWindow.screenX = String(
        Math.round((workArea.x + Math.max(0, (workArea.width - width) / 2)) * scaleFactor)
      );
      mainWindow.screenY = String(
        Math.round((workArea.y + Math.max(0, (workArea.height - height) / 2)) * scaleFactor)
      );
    }
    writeFileSync(
      path.join(profilePath, "xulstore.json"),
      JSON.stringify({ "chrome://browser/content/browser.xhtml": { "main-window": mainWindow } })
    );

    const chromeDir = path.join(profilePath, "chrome");
    mkdirSync(chromeDir, { recursive: true });
    writeFileSync(
      path.join(chromeDir, "userChrome.css"),
      [
        "#TabsToolbar, #nav-bar, #PersonalToolbar, #sidebar-main, #sidebar-box {",
        "  visibility: collapse !important;",
        "}",
        "",
      ].join("\n")
    );
  }

  /**
   * The primary display's work area in logical pixels (the same units Firefox
   * uses for window size) and its scale factor, or null when not running
   * inside Electron.
   */
  private primaryWorkArea():
    | { x: number; y: number; width: number; height: number; scaleFactor: number }
    | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { screen } = require("electron");
      const display = screen?.getPrimaryDisplay?.();
      return display ? { ...display.workArea, scaleFactor: display.scaleFactor } : null;
    } catch {
      return null;
    }
  }

  /**
   * Undo prepareFirefoxProfile before archiving: the stripped-down window is
   * for this login only, not something whoever restores the profile should get.
   */
  private cleanFirefoxProfile(profilePath: string): void {
    rmSync(path.join(profilePath, "user.js"), { force: true });
    rmSync(path.join(profilePath, "xulstore.json"), { force: true });
    rmSync(path.join(profilePath, "chrome"), { recursive: true, force: true });
  }

  /**
   * Phase 1: Launch Firefox for interactive login (no automation)
   */
  private launchFirefox(firefoxPath: string, profilePath: string, url: string): ChildProcess {
    // -no-remote and -new-instance are what make this a login we can wait on.
    // Firefox's default behaviour, when any Firefox is already running, is to
    // hand the URL to that instance and exit immediately: the spawned process
    // dies in milliseconds, the wait-for-exit below returns at once, and what
    // gets archived is the empty temp profile the user never typed into.
    //
    // -wait-for-browser is needed on Windows because firefox.exe is a launcher
    // process: it starts the real browser process and exits within ~200ms.
    // Without it we'd treat that exit as the user closing the window, then
    // delete the temp profile while Firefox is still starting up on it. On
    // macOS the binary inside Firefox.app is the browser itself.
    const args = [
      ...(process.platform === "win32" ? ["-wait-for-browser"] : []),
      "-no-remote",
      "-new-instance",
      "-profile",
      profilePath,
      url,
    ];

    console.log(`[InteractiveLogin] Launching Firefox with args:`, args);

    return spawn(firefoxPath, args, {
      detached: true,
      stdio: "ignore",
    });
  }

  /** Run a JXA script with arguments: its output, or null if osascript failed. */
  private runJxa(script: string, ...args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile("osascript", ["-l", "JavaScript", "-e", script, ...args], { timeout: 5000 }, (err, stdout) =>
        resolve(err ? null : String(stdout).trim())
      );
    });
  }

  /** Wait up to `ms` for the browser to exit; whether it did. */
  private async waitForExit(hasExited: () => boolean, ms: number): Promise<boolean> {
    const start = Date.now();
    while (!hasExited() && Date.now() - start < ms) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return hasExited();
  }

  /**
   * On macOS closing Firefox's last window doesn't quit it: Firefox keeps
   * running with only its menu bar, and the login would wait for an exit that
   * never comes (then time out and throw the session away). So once the login
   * window has been seen and is then gone, quit Firefox the way ⌘Q would -
   * which is also what makes it write everything out to the profile.
   *
   * Anything unexpected (osascript failing, the window never showing up in the
   * list) leaves it doing nothing: quitting with ⌘Q still ends the login.
   */
  private watchForClosedMacWindow(pid: number, hasExited: () => boolean): void {
    let seenWindow = false;
    let emptyPolls = 0;
    let failures = 0;
    (async () => {
      while (!hasExited()) {
        await new Promise(resolve => setTimeout(resolve, MAC_WINDOW_POLL_MS));
        if (hasExited()) return;
        const out = await this.runJxa(MAC_WINDOW_COUNT_SCRIPT, String(pid));
        const count = out === null ? NaN : Number(out);
        if (Number.isNaN(count)) {
          if (++failures >= 5) {
            console.warn(`[InteractiveLogin] Can't watch the login window (osascript: ${out}); waiting for Firefox to quit`);
            return;
          }
          continue;
        }
        failures = 0;
        if (count > 0) {
          seenWindow = true;
          emptyPolls = 0;
          continue;
        }
        // Two empty polls in a row, so a window being replaced doesn't count.
        if (!seenWindow || ++emptyPolls < 2) continue;
        console.log(`[InteractiveLogin] Login window closed; quitting Firefox`);
        await this.runJxa(MAC_QUIT_SCRIPT, String(pid));
        return;
      }
    })();
  }

  /**
   * Close the browser and everything it spawned, gracefully first so it
   * flushes cookies and storage to the profile, then by force.
   *
   * On Windows process.kill(-pid) throws (there are no process groups) and
   * browserProc.kill() only ends the launcher, leaving the browser window and
   * its child processes running. taskkill /T walks the whole process tree.
   */
  private async terminateBrowser(
    browserProc: ChildProcess,
    profilePath: string,
    hasExited: () => boolean
  ): Promise<void> {
    const pid = browserProc.pid;
    if (!pid) return;

    if (process.platform === "darwin") {
      await this.runJxa(MAC_QUIT_SCRIPT, String(pid));
      if (await this.waitForExit(hasExited, 10000)) return;
      console.warn(`[InteractiveLogin] Firefox did not quit within 10s, forcing it`);
    }

    if (process.platform === "win32") {
      // Close the window the way the user would. taskkill without /F doesn't
      // do this: Firefox's processes refuse it ("can only be terminated
      // forcefully"). The browser process is the one whose command line names
      // this login's temp profile.
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${profilePath.replace(/'/g, "''")}*' } | ` +
        `ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).CloseMainWindow() } | Out-Null`;
      spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });

      const graceMs = 10000;
      if (await this.waitForExit(hasExited, graceMs)) return;

      console.warn(`[InteractiveLogin] Browser did not close within ${graceMs / 1000}s, forcing it`);
      const forced = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      if (forced.status !== 0) {
        console.warn(`[InteractiveLogin] taskkill /F exited with status ${forced.status}`);
      }
      return;
    }

    try {
      process.kill(-pid, "SIGTERM");
    } catch (e) {
      console.warn(`[InteractiveLogin] Failed to terminate browser: ${e}`);
      try {
        browserProc.kill("SIGKILL");
      } catch (e2) {
        console.warn(`[InteractiveLogin] Failed to force kill: ${e2}`);
      }
    }
  }

  /**
   * Interactive login: open Firefox on Vinted, wait until the user has logged
   * in, close Firefox, and archive the profile it left behind.
   *
   * The window closes by itself once the profile holds a logged-in session
   * (see hasCompleteVintedLogin). The user can also close it themselves; that
   * still saves the session, in case the login check ever misses one.
   */
  async interactiveLogin(options: InteractiveLoginOptions): Promise<InteractiveLoginResult> {
    const { url, profileName, timeout = 300, onStatus } = options;

    console.log(`[InteractiveLogin] Starting interactive login for ${profileName}`);
    console.log(`[InteractiveLogin] URL: ${url}, Timeout: ${timeout}s`);

    // Create temporary profile directory
    const tempDir = os.tmpdir();
    this.tempProfileDir = path.join(tempDir, `vinted_login_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(this.tempProfileDir, { recursive: true });

    const loginStartTime = Date.now();

    try {
      // Find Firefox executable
      const browserPath = this.findFirefoxPath();
      console.log(`[InteractiveLogin] Browser path: ${browserPath}`);

      // Phase 1: Launch Firefox for login
      console.log(`[InteractiveLogin] Phase 1: Launching Firefox for interactive login...`);
      this.prepareFirefoxProfile(this.tempProfileDir);
      const launchedProfileDir = this.tempProfileDir;
      const browserProc = this.launchFirefox(browserPath, launchedProfileDir, url);
      onStatus?.("waiting-for-login");

      let closed = false;
      if (process.platform === "darwin" && browserProc.pid) {
        this.watchForClosedMacWindow(browserProc.pid, () => closed);
      }

      // Who closed the window: the user (null), or this app for a reason
      let closedBy: "login" | "timeout" | "cancel" | null = null;
      const closeBrowser = (reason: NonNullable<typeof closedBy>) => {
        if (closed || closedBy) return;
        closedBy = reason;
        console.log(`[InteractiveLogin] Closing Firefox (${reason})...`);
        void this.terminateBrowser(browserProc, launchedProfileDir, () => closed);
      };

      const waitForClose = new Promise<void>((resolve) => {
        // Cleared once the window closes, so it doesn't sit armed (holding
        // this login's state) for the rest of the timeout.
        const timer = setTimeout(() => closeBrowser("timeout"), timeout * 1000);
        browserProc.on("exit", () => {
          closed = true;
          clearTimeout(timer);
          resolve();
        });
      });
      this.cancelLogin = () => closeBrowser("cancel");

      // Close the window once the user is logged in. Reading the profile's
      // cookies (not the page) is what proves the session is on disk, ready
      // to be archived, before the window closes.
      void (async () => {
        while (!closed && !closedBy) {
          await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_MS));
          if (closed || closedBy) return;
          if (!hasCompleteVintedLogin(await readVintedCookies(launchedProfileDir))) continue;

          console.log(`[InteractiveLogin] Logged in to Vinted; closing Firefox shortly`);
          onStatus?.("logged-in");
          await new Promise((resolve) => setTimeout(resolve, LOGGED_IN_SETTLE_MS));
          closeBrowser("login");
          return;
        }
      })();

      await waitForClose;
      this.cancelLogin = null;

      const loginDuration = Date.now() - loginStartTime;
      console.log(
        `[InteractiveLogin] Browser closed after ${(loginDuration / 1000).toFixed(1)}s ` +
          `(by ${closedBy ? `this app: ${closedBy}` : "the user"})`
      );

      // Nothing is archived, uploaded or linked after a timeout or cancel; the
      // temp profile is discarded in the finally below.
      if (closedBy === "cancel") {
        throw new LoginFlowError("LOGIN_CANCELLED", "The login was cancelled, so nothing was saved.");
      }
      if (closedBy === "timeout") {
        const limit = timeout >= 60 ? `${Math.round(timeout / 60)} minutes` : `${timeout} seconds`;
        throw new LoginFlowError(
          "LOGIN_TIMEOUT",
          `Time ran out (${limit}) before you logged in, so nothing was saved. Start again to log in.`
        );
      }
      onStatus?.("saving");

      // Give OS time to release file locks
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.cleanFirefoxProfile(this.tempProfileDir);

      // Recorded, never blocking. A check that stopped here would also throw
      // away the profile (cleaned up below), losing a real login if the check
      // were ever wrong - so the profile is always archived and uploaded.
      const vintedCookies = await readVintedCookies(this.tempProfileDir);
      const login = vintedLoginState(vintedCookies);
      console.log(
        `[InteractiveLogin] Vinted login state when the window closed: ${login}`
      );

      // Phase 2: Compress entire profile folder to tar.gz
      console.log(`[InteractiveLogin] Phase 2: Compressing profile folder to tar.gz...`);
      const compressStartTime = Date.now();
      const archivePath = path.join(os.tmpdir(), `vinted_login_${archiveNamePart(profileName)}_${Date.now()}.tar.gz`);

      try {
        // The whole profile minus what Firefox rebuilds by itself (caches,
        // crash data, downloadable components) - see profileArchive. The
        // complete folder is 100+ MB compressed, over Cloudflare's 100 MB
        // request limit in front of api.vinbot.app, and was rejected with 413.
        await tar.create(
          {
            gzip: true,
            file: archivePath,
            cwd: path.dirname(this.tempProfileDir),
            filter: includeInProfileArchive,
          },
          [path.basename(this.tempProfileDir)]
        );

        const stats = statSync(archivePath);
        const archiveSizeBytes = stats.size;
        const archiveSizeMB = (archiveSizeBytes / (1024 * 1024)).toFixed(2);
        const compressTime = Date.now() - compressStartTime;

        console.log(
          `[InteractiveLogin] ✅ Profile compressed to tar.gz: ${archiveSizeMB}MB in ${compressTime}ms`
        );

        const result: InteractiveLoginResult = {
          profile_name: profileName,
          profile_path: this.tempProfileDir,
          url: url,
          profile_archive_path: archivePath,
          profile_archive_size: archiveSizeBytes,
          extracted_at: Date.now(),
          loginDuration: loginDuration,
          compressed_at: Date.now(),
          vinted_login: login,
          vinted_cookies: vintedCookies ?? [],
        };

        return result;
      } catch (compressError) {
        const msg = compressError instanceof Error ? compressError.message : String(compressError);
        console.error(`[InteractiveLogin] ❌ Compression failed: ${msg}`);
        throw new Error(`Profile compression failed: ${msg}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[InteractiveLogin] ❌ Failed: ${msg}`);
      if (error instanceof LoginFlowError) throw error;
      throw new Error(`Interactive login failed: ${msg}`);
    } finally {
      this.cancelLogin = null;
      // Cleanup temp profile directory
      if (this.tempProfileDir && existsSync(this.tempProfileDir)) {
        try {
          rmSync(this.tempProfileDir, { recursive: true, force: true });
          console.log(`[InteractiveLogin] Cleaned up temp profile directory`);
        } catch (e) {
          console.warn(`[InteractiveLogin] Failed to cleanup temp directory: ${e}`);
        }
      }
    }
  }
}
