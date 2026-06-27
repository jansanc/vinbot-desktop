import path from "path";
import os from "os";
import { existsSync, readdirSync } from "fs";

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReaddirSync = readdirSync as jest.MockedFunction<
  typeof readdirSync
>;

import {
  getChromeProfiles,
  getEdgeProfiles,
} from "../../../main/extractors/chrome.extractor";

describe("chrome.extractor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getChromeProfiles", () => {
    it("should return empty array when Chrome data directory does not exist", () => {
      mockedExistsSync.mockReturnValue(false);

      const result = getChromeProfiles();

      expect(result).toEqual([]);
    });

    it("should return profile directories that start with 'Profile'", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "Profile 1",
        "Profile 2",
        "Default",
        "Crashpad",
        "Local State",
      ] as unknown as import("fs").Dirent[]);

      const result = getChromeProfiles();

      expect(result).toContain("Profile 1");
      expect(result).toContain("Profile 2");
      expect(result).toContain("Default");
      expect(result).not.toContain("Crashpad");
      expect(result).not.toContain("Local State");
    });

    it("should include 'Guest Profile' directory", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "Default",
        "Guest Profile",
        "System Profile",
      ] as unknown as import("fs").Dirent[]);

      const result = getChromeProfiles();

      expect(result).toContain("Default");
      expect(result).toContain("Guest Profile");
      expect(result).not.toContain("System Profile");
    });

    it("should return sorted profiles", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "Profile 3",
        "Profile 1",
        "Default",
        "Profile 2",
      ] as unknown as import("fs").Dirent[]);

      const result = getChromeProfiles();

      expect(result).toEqual(["Default", "Profile 1", "Profile 2", "Profile 3"]);
    });

    it("should return empty array on filesystem error", () => {
      mockedExistsSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = getChromeProfiles();

      expect(result).toEqual([]);
    });

    it("should return empty array when directory listing fails", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation(() => {
        throw new Error("Access denied");
      });

      const result = getChromeProfiles();

      expect(result).toEqual([]);
    });
  });

  describe("getEdgeProfiles", () => {
    it("should return empty array when Edge data directory does not exist", () => {
      mockedExistsSync.mockReturnValue(false);

      const result = getEdgeProfiles();

      expect(result).toEqual([]);
    });

    it("should return profile directories that start with 'Profile'", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "Profile 1",
        "Default",
        "Bookmarks",
        "Extensions",
      ] as unknown as import("fs").Dirent[]);

      const result = getEdgeProfiles();

      expect(result).toContain("Profile 1");
      expect(result).toContain("Default");
      expect(result).not.toContain("Bookmarks");
      expect(result).not.toContain("Extensions");
    });

    it("should include 'Guest Profile' directory", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "Default",
        "Guest Profile",
      ] as unknown as import("fs").Dirent[]);

      const result = getEdgeProfiles();

      expect(result).toContain("Default");
      expect(result).toContain("Guest Profile");
    });

    it("should return sorted profiles", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "Profile 2",
        "Default",
        "Profile 1",
      ] as unknown as import("fs").Dirent[]);

      const result = getEdgeProfiles();

      expect(result).toEqual(["Default", "Profile 1", "Profile 2"]);
    });

    it("should return empty array on filesystem error", () => {
      mockedExistsSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = getEdgeProfiles();

      expect(result).toEqual([]);
    });
  });
});
