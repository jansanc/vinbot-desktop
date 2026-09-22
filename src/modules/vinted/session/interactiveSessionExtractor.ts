import path from "path";
import os from "os";
import { spawn, ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from "fs";
import * as tar from "tar";
import { includeInProfileArchive } from "../profile/profileArchive";

export interface InteractiveLoginOptions {
  url: string;
  profileName: string;
  browser: "chrome" | "firefox" | "edge";
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

export class InteractiveSessionExtractor {
  private appData = process.env.APPDATA || "";
  private programFiles = process.env.ProgramFiles || "C:\\Program Files";
  private programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  private tempProfileDir: string | null = null;

  /**
   * Find browser executable path
   */
  private findBrowserPath(browser: "chrome" | "firefox" | "edge"): string {
    let paths: string[] = [];

    if (browser === "chrome") {
      paths = [
        path.join(this.programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(this.programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(this.appData, "..\\Local Settings\\Application Data\\Google\\Chrome\\Application\\chrome.exe"),
      ];
    } else if (browser === "firefox") {
      paths = [
        path.join(this.programFiles, "Mozilla Firefox", "firefox.exe"),
        path.join(this.programFilesX86, "Mozilla Firefox", "firefox.exe"),
      ];
    } else if (browser === "edge") {
      paths = [
        path.join(this.programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(this.programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      ];
    }

    for (const p of paths) {
      if (existsSync(p)) {
        return p;
      }
    }

    throw new Error(`Could not find ${browser} browser executable`);
  }

  /**
   * Phase 1: Launch browser for interactive login (no automation)
   */
  private launchBrowser(
    browserPath: string,
    profilePath: string,
    url: string,
    browser: "chrome" | "firefox" | "edge"
  ): ChildProcess {
    const args: string[] = [];

    if (browser === "chrome" || browser === "edge") {
      args.push(
        `--user-data-dir=${profilePath}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-plugins",
        url
      );
    } else if (browser === "firefox") {
      // -no-remote and -new-instance are what make this a login we can wait on.
      // Firefox's default behaviour, when any Firefox is already running, is to
      // hand the URL to that instance and exit immediately: the spawned process
      // dies in milliseconds, the wait-for-exit below returns at once, and what
      // gets archived is the empty temp profile the user never typed into.
      args.push("-no-remote", "-new-instance", "-profile", profilePath, url);
    }

    console.log(`[InteractiveLogin] Launching ${browser} with args:`, args);

    const proc = spawn(browserPath, args, {
      detached: true,
      stdio: "ignore",
    });

    return proc;
  }

  /**
   * Interactive login: Open browser for user login, then extract session
   */
  async interactiveLogin(options: InteractiveLoginOptions): Promise<InteractiveLoginResult> {
    const {
      url,
      profileName,
      browser,
      timeout = 300,
      headless = false,
    } = options;

    console.log(`[InteractiveLogin] Starting interactive login for ${profileName}`);
    console.log(`[InteractiveLogin] URL: ${url}, Browser: ${browser}, Timeout: ${timeout}s`);

    // Create temporary profile directory
    const tempDir = os.tmpdir();
    this.tempProfileDir = path.join(tempDir, `vinted_login_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(this.tempProfileDir, { recursive: true });

    const loginStartTime = Date.now();

    try {
      // Find browser executable
      const browserPath = this.findBrowserPath(browser);
      console.log(`[InteractiveLogin] Browser path: ${browserPath}`);

      // Phase 1: Launch browser for login
      console.log(`[InteractiveLogin] Phase 1: Launching browser for interactive login...`);
      const browserProc = this.launchBrowser(browserPath, this.tempProfileDir, url, browser);

      // Wait for user to close browser or timeout
      let closed = false;
      const waitForClose = new Promise<void>((resolve) => {
        browserProc.on("exit", () => {
          closed = true;
          resolve();
        });

        setTimeout(() => {
          if (!closed) {
            console.log(`[InteractiveLogin] Timeout reached (${timeout}s), terminating browser...`);
            try {
              if (browserProc.pid) {
                process.kill(-browserProc.pid, "SIGTERM");
              } else {
                browserProc.kill("SIGTERM");
              }
            } catch (e) {
              console.warn(`[InteractiveLogin] Failed to terminate browser: ${e}`);
              try {
                browserProc.kill("SIGKILL");
              } catch (e2) {
                console.warn(`[InteractiveLogin] Failed to force kill: ${e2}`);
              }
            }
          }
          resolve();
        }, timeout * 1000);
      });

      await waitForClose;

      const loginDuration = Date.now() - loginStartTime;
      console.log(`[InteractiveLogin] Browser closed after ${(loginDuration / 1000).toFixed(1)}s`);

      // Give OS time to release file locks
      await new Promise(resolve => setTimeout(resolve, 1000));

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
