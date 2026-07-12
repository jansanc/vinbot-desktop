/**
 * Storage State Manager
 *
 * Handles the read → use → write-back loop for Playwright storage states.
 * Keeps tokens fresh and DataDome cookies valid by writing back after each use.
 */

import * as fs from "fs";
import * as path from "path";
import { StorageStateService, StorageState, StorageStateContextConfig } from "./storage-state.service";

export class StorageStateManager {
  private readonly baseDir: string;
  private readonly accountId: string;
  private readonly browser: string;
  private readonly profileId: string;

  constructor(baseDir: string, accountId: string, browser: string, profileId: string) {
    this.baseDir = baseDir;
    this.accountId = accountId;
    this.browser = browser;
    this.profileId = profileId;
  }

  /**
   * Get the storage state file path
   */
  private getStorageStatePath(): string {
    return path.join(
      this.baseDir,
      "storage-states",
      this.accountId,
      this.browser,
      `${this.profileId}.json`
    );
  }

  /**
   * Load existing storage state (read phase)
   */
  async loadStorageState(): Promise<StorageState | null> {
    try {
      const filePath = this.getStorageStatePath();
      if (!fs.existsSync(filePath)) {
        console.log(
          `[StorageStateManager] No existing storage state for ${this.accountId}/${this.browser}/${this.profileId}`
        );
        return null;
      }

      const state = await StorageStateService.loadStorageState(filePath);
      const summary = StorageStateService.getSummary(state);

      console.log(
        `[StorageStateManager] Loaded storage state: ${summary.cookieCount} cookies, ${summary.origins} origins, ${(summary.totalSize / 1024).toFixed(1)}KB`
      );
      console.log(
        `[StorageStateManager] Critical cookies: ${summary.criticalCookies.join(", ")}`
      );

      return state;
    } catch (error) {
      console.error(
        `[StorageStateManager] Failed to load storage state: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Save/update storage state (write-back phase)
   * Call this after using the context to capture fresh tokens
   */
  async saveStorageState(context: any, contextConfig: Omit<StorageStateContextConfig, "capturedAt">): Promise<StorageState> {
    try {
      console.log(`[StorageStateManager] Capturing fresh storage state...`);

      // Capture current state from context
      const state = await StorageStateService.captureStorageState(context, contextConfig);
      const summary = StorageStateService.getSummary(state);

      // Save to disk
      const filePath = this.getStorageStatePath();
      await StorageStateService.saveStorageState(filePath, state);

      console.log(
        `[StorageStateManager] Saved fresh storage state: ${summary.cookieCount} cookies, ${summary.origins} origins, ${(summary.totalSize / 1024).toFixed(1)}KB`
      );
      console.log(
        `[StorageStateManager] Critical cookies updated: ${summary.criticalCookies.join(", ")}`
      );

      return state;
    } catch (error) {
      console.error(
        `[StorageStateManager] Failed to save storage state: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Execute a job with automatic save-back
   * Handles the complete read → use → write-back loop
   */
  async withStorageState<T>(
    context: any,
    contextConfig: Omit<StorageStateContextConfig, "capturedAt">,
    job: (state: StorageState | null) => Promise<T>
  ): Promise<{ result: T; state: StorageState }> {
    // Read phase
    const previousState = await this.loadStorageState();

    try {
      // Use phase - run the job
      console.log(`[StorageStateManager] Running job...`);
      const result = await job(previousState);

      // Write-back phase - capture fresh state
      const freshState = await this.saveStorageState(context, contextConfig);

      return { result, state: freshState };
    } catch (error) {
      console.error(
        `[StorageStateManager] Job failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get storage state summary for debugging
   */
  async getSummary(): Promise<any> {
    const state = await this.loadStorageState();
    if (!state) {
      return { exists: false };
    }

    const summary = StorageStateService.getSummary(state);
    const filePath = this.getStorageStatePath();
    const stats = fs.statSync(filePath);

    return {
      exists: true,
      path: filePath,
      size: stats.size,
      sizeKB: (stats.size / 1024).toFixed(1),
      ...summary,
      capturedAt: state.contextConfig.capturedAt,
      capturedAtDate: new Date(state.contextConfig.capturedAt).toISOString(),
      age: `${Math.round((Date.now() - state.contextConfig.capturedAt) / 1000 / 60)} minutes ago`,
    };
  }

  /**
   * Delete storage state
   */
  async deleteStorageState(): Promise<void> {
    try {
      const filePath = this.getStorageStatePath();
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(
          `[StorageStateManager] Deleted storage state: ${filePath}`
        );
      }
    } catch (error) {
      console.error(
        `[StorageStateManager] Failed to delete storage state: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
