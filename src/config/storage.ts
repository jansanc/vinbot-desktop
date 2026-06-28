import { config } from "./config";

/**
 * Storage adapter that falls back to in-memory storage if localStorage is unavailable
 * Useful for development, testing, or Electron environments
 */
export const storage = {
  /**
   * Set item in localStorage with fallback to memory
   */
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn(`localStorage unavailable, using memory storage for "${key}"`);
      config.storage.memoryStore.set(key, value);
    }
  },

  /**
   * Get item from localStorage with fallback to memory
   */
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`localStorage unavailable, reading from memory storage for "${key}"`);
      return config.storage.memoryStore.get(key) ?? null;
    }
  },

  /**
   * Remove item from localStorage with fallback to memory
   */
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`localStorage unavailable, removing from memory storage for "${key}"`);
      config.storage.memoryStore.delete(key);
    }
  },

  /**
   * Clear all items (development only)
   */
  clear(): void {
    try {
      localStorage.clear();
    } catch (error) {
      console.warn("localStorage unavailable, clearing memory storage");
      config.storage.memoryStore.clear();
    }
  },
};
