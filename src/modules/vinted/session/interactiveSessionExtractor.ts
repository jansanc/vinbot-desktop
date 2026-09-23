import path from "path";
import os from "os";
import { spawn, spawnSync, ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from "fs";
import * as tar from "tar";
import { includeInProfileArchive } from "../profile/profileArchive";

export interface InteractiveLoginOptions {
  url: string;
  profileName: string;
  timeout?: number;
  headless?: boolean;
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
}

/** Size of the login window, in logical (DPI-scaled) pixels: a small window,
 * just wide enough for Vinted's login form and the Google/Apple sign-in popups. */
const LOGIN_WINDOW_SIZE = { width: 520, height: 720 };

export class InteractiveSessionExtractor {
  private programFiles = process.env.ProgramFiles || "C:\\Program Files";
  private programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  private tempProfileDir: string | null = null;

  /**
   * Find the Firefox executable. The interactive login only ever launches
   * Firefox; Chrome and Edge are never started by this app.
   */
  private findFirefoxPath(): string {
    const paths = [
      path.join(this.programFiles, "Mozilla Firefox", "firefox.exe"),
      path.join(this.programFilesX86, "Mozilla Firefox", "firefox.exe"),
    ];

    for (const p of paths) {
      if (existsSync(p)) {
        return p;
      }
    }

    throw new Error("Could not find Firefox. Please install Firefox and try again.");
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
      // Centred. Firefox reads the size in logical pixels but the position in
      // physical ones, hence the scale factor on screenX/screenY only.
      const { scaleFactor } = workArea;
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
   * Whether the closed profile holds a logged-in Vinted session.
   *
   * Vinted hands every visitor access_token_web/refresh_token_web cookies, so
   * their presence proves nothing. They are JWTs, though: an anonymous one
   * has scope "public" and no subject; a logged-in one names the user.
   *
   * "unknown" when the cookies can't be read reliably - no cookies.sqlite, no
   * token, or recent writes still sitting in cookies.sqlite-wal (sql.js reads
   * the main file only, and a forced close can leave the WAL un-checkpointed).
   * Callers only block on a definite "anonymous".
   */
  private async checkVintedLogin(profilePath: string): Promise<"logged-in" | "anonymous" | "unknown"> {
    const dbPath = path.join(profilePath, "cookies.sqlite");
    const walPath = `${dbPath}-wal`;
    if (!existsSync(dbPath)) return "unknown";
    const walHasData = existsSync(walPath) && statSync(walPath).size > 0;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs();
      const db = new SQL.Database(readFileSync(dbPath));
      const rows = db.exec(
        "SELECT value FROM moz_cookies WHERE host LIKE '%vinted.%' AND name IN ('refresh_token_web', 'access_token_web')"
      );
      db.close();

      const tokens: string[] = rows.length ? rows[0].values.map((v: unknown[]) => String(v[0])) : [];
      for (const token of tokens) {
        const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
        if (claims.sub || (claims.scope && claims.scope !== "public")) {
          console.log(`[InteractiveLogin] Vinted session is logged in (scope: ${claims.scope})`);
          return "logged-in";
        }
      }

      if (tokens.length && !walHasData) {
        console.warn(`[InteractiveLogin] Vinted session is anonymous (only scope "public" tokens)`);
        return "anonymous";
      }
      console.warn(
        `[InteractiveLogin] Could not tell whether Vinted is logged in (tokens: ${tokens.length}, WAL pending: ${walHasData})`
      );
      return "unknown";
    } catch (e) {
      console.warn(`[InteractiveLogin] Could not read Vinted cookies: ${e}`);
      return "unknown";
    }
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
    // delete the temp profile while Firefox is still starting up on it.
    const args = ["-wait-for-browser", "-no-remote", "-new-instance", "-profile", profilePath, url];

    console.log(`[InteractiveLogin] Launching Firefox with args:`, args);

    return spawn(firefoxPath, args, {
      detached: true,
      stdio: "ignore",
    });
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
      const start = Date.now();
      while (!hasExited() && Date.now() - start < graceMs) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (hasExited()) return;

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
   * Interactive login: Open browser for user login, then extract session
   */
  async interactiveLogin(options: InteractiveLoginOptions): Promise<InteractiveLoginResult> {
    const {
      url,
      profileName,
      timeout = 300,
      headless = false,
    } = options;

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

      // Wait for user to close browser or timeout
      let closed = false;
      const waitForClose = new Promise<void>((resolve) => {
        browserProc.on("exit", () => {
          closed = true;
          resolve();
        });

        setTimeout(async () => {
          if (!closed) {
            console.log(`[InteractiveLogin] Timeout reached (${timeout}s), terminating browser...`);
            await this.terminateBrowser(browserProc, launchedProfileDir, () => closed);
          }
          resolve();
        }, timeout * 1000);
      });

      await waitForClose;

      const loginDuration = Date.now() - loginStartTime;
      console.log(`[InteractiveLogin] Browser closed after ${(loginDuration / 1000).toFixed(1)}s`);

      // Give OS time to release file locks
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.cleanFirefoxProfile(this.tempProfileDir);

      // Don't archive (and later upload and link) a profile nobody logged in on,
      // e.g. when the window was closed early or the wait timed out.
      const login = await this.checkVintedLogin(this.tempProfileDir);
      if (login === "anonymous") {
        throw new Error(
          "You're not logged in to Vinted. Log in in the window that opens, then close it."
        );
      }

      // Phase 2: Compress entire profile folder to tar.gz
      console.log(`[InteractiveLogin] Phase 2: Compressing profile folder to tar.gz...`);
      const compressStartTime = Date.now();
      const archivePath = path.join(os.tmpdir(), `vinted_login_${profileName}_${Date.now()}.tar.gz`);

      try {
        // Same contents as ProfileUploader: session state, no caches.
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
      throw new Error(`Interactive login failed: ${msg}`);
    } finally {
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
