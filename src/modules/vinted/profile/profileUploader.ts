import path from "path";
import { existsSync, writeFileSync, statSync } from "fs";
import * as tar from "tar";
import { ChromeCookieExtractor } from "../../../services/chrome-cookie-extractor";
import { StorageStateService } from "../../../services/storage-state.service";
import { includeInProfileArchive } from "./profileArchive";


export class ProfileUploader {
  private appData = process.env.APPDATA || "";
  private programFiles = process.env.ProgramFiles || "C:\\Program Files";
  private programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  /**
   * Get profile directory path for different browsers
   */
  getProfilePath(browser: "chrome" | "firefox" | "edge", profileId: string): string {
    if (browser === "chrome") {
      const userDataDir = path.join(this.appData, "Google", "Chrome", "User Data");
      return path.join(userDataDir, profileId);
    } else if (browser === "firefox") {
      const firefoxDir = path.join(this.appData, "Mozilla\\Firefox\\Profiles");
      return path.join(firefoxDir, profileId);
    } else if (browser === "edge") {
      const userDataDir = path.join(this.appData, "Microsoft", "Edge", "User Data");
      return path.join(userDataDir, profileId);
    }
    throw new Error(`Unsupported browser: ${browser}`);
  }

  /**
   * Compress entire profile folder to tar.gz format
   * Returns complete browser profile for full restoration
   */
  async compressProfileToTarGz(
    profilePath: string,
    outputPath: string,
    onProgress?: (msg: string) => void
  ): Promise<number> {
    const startTime = Date.now();

    try {
      if (!existsSync(profilePath)) {
        throw new Error(`Profile path not found: ${profilePath}`);
      }

      onProgress?.(`🚀 Compressing profile folder to tar.gz (caches excluded)...`);

      // Everything the session needs, none of the caches - see profileArchive.
      await tar.create(
        {
          gzip: true,
          file: outputPath,
          cwd: path.dirname(profilePath),
          filter: includeInProfileArchive,
        },
        [path.basename(profilePath)]
      );

      // Get compressed file size
      const stats = statSync(outputPath);
      const fileSizeBytes = stats.size;
      const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
      const elapsedMs = Date.now() - startTime;

      onProgress?.(
        `✅ Profile compressed to tar.gz in ${elapsedMs}ms (${fileSizeMB}MB)`
      );
      console.log(
        `[ProfileUploader] Profile compressed to tar.gz: ${fileSizeMB}MB in ${elapsedMs}ms`
      );

      return fileSizeBytes;
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      onProgress?.(`❌ Profile compression failed after ${elapsedMs}ms: ${msg}`);
      console.error(`[ProfileUploader] Profile compression error: ${msg}`);
      throw error;
    }
  }

  /**
   * Extract storageState (cookies + localStorage) from Chrome profile
   * Returns JSON file (~8KB) instead of archiving 434MB profile
   *
   * This is 1000x smaller and 100x faster than profile archiving.
   */
  async extractStorageState(
    profilePath: string,
    outputPath: string,
    contextConfig: {
      userAgent: string;
      locale: string;
      timezoneId: string;
      viewport: { width: number; height: number };
    },
    onProgress?: (msg: string) => void
  ): Promise<number> {
    const startTime = Date.now();

    try {
      if (!existsSync(profilePath)) {
        throw new Error(`Profile path not found: ${profilePath}`);
      }

      onProgress?.(`🚀 Extracting storageState from Chrome profile (instead of archiving!)`);

      // Extract cookies from Chrome's SQLite database
      onProgress?.(`Reading cookies from Chrome database...`);
      const storageState = await ChromeCookieExtractor.extractStorageStateFromChrome(profilePath, {
        userAgent: contextConfig.userAgent,
        locale: contextConfig.locale,
        timezoneId: contextConfig.timezoneId,
        viewport: contextConfig.viewport,
      });

      // Write storageState JSON to file
      onProgress?.(`Writing storageState JSON...`);
      const jsonContent = JSON.stringify(storageState, null, 2);
      writeFileSync(outputPath, jsonContent, "utf-8");

      const fileSize = jsonContent.length;
      const elapsedMs = Date.now() - startTime;

      const summary = StorageStateService.getSummary(storageState);
      onProgress?.(
        `✅ StorageState extracted in ${elapsedMs}ms (${(fileSize / 1024).toFixed(1)}KB, ${summary.cookieCount} cookies)`
      );
      console.log(
        `[ProfileUploader] StorageState extracted: ${(fileSize / 1024).toFixed(1)}KB in ${elapsedMs}ms`
      );

      return fileSize;
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      onProgress?.(`❌ StorageState extraction failed after ${elapsedMs}ms: ${msg}`);
      console.error(`[ProfileUploader] StorageState extraction error: ${msg}`);
      throw error;
    }
  }

}
