import path from "path";
import os from "os";
import { readFileSync, existsSync, readdirSync } from "fs";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

const mockedReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReaddirSync = readdirSync as jest.MockedFunction<
  typeof readdirSync
>;

import {
  parseFirefoxPrefs,
  getFirefoxVersion,
  getDefaultFonts,
  extractFingerprint,
  extractCookies,
  extractLocalStorage,
  extractSessionStorage,
  extractFirefoxProfileData,
} from "../../../main/extractors/firefox.extractor";
import { execSync } from "child_process";

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

// Access private functions via module internals by re-importing
// We test them indirectly through the exported functions, but we can also
// test the utility functions that are not exported by calling them through
// the exported functions that use them.

describe("firefox.extractor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("parseFirefoxPrefs", () => {
    it("should parse prefs.js with string values", () => {
      const prefsContent = `user_pref("intl.accept_languages", "en-GB,es");
user_pref("general.useragent.locale", "en-GB");`;

      mockedReadFileSync.mockReturnValue(prefsContent);

      const result = parseFirefoxPrefs("/fake/profile");

      expect(result["intl.accept_languages"]).toBe("en-GB,es");
      expect(result["general.useragent.locale"]).toBe("en-GB");
    });

    it("should parse boolean values", () => {
      const prefsContent = `user_pref("browser.cache.disk.enable", true);
user_pref("browser.cache.memory.enable", false);`;

      mockedReadFileSync.mockReturnValue(prefsContent);

      const result = parseFirefoxPrefs("/fake/profile");

      expect(result["browser.cache.disk.enable"]).toBe(true);
      expect(result["browser.cache.memory.enable"]).toBe(false);
    });

    it("should parse numeric values", () => {
      const prefsContent = `user_pref("browser.cache.disk.capacity", 1048576);
user_pref("network.http.max-connections", 900);`;

      mockedReadFileSync.mockReturnValue(prefsContent);

      const result = parseFirefoxPrefs("/fake/profile");

      expect(result["browser.cache.disk.capacity"]).toBe(1048576);
      expect(result["network.http.max-connections"]).toBe(900);
    });

    it("should return empty object when prefs.js cannot be read", () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = parseFirefoxPrefs("/nonexistent/profile");

      expect(result).toEqual({});
    });

    it("should handle empty prefs.js file", () => {
      mockedReadFileSync.mockReturnValue("");

      const result = parseFirefoxPrefs("/fake/profile");

      expect(result).toEqual({});
    });

    it("should handle malformed lines gracefully", () => {
      const prefsContent = `// This is a comment
user_pref("valid.key", "valid_value");
some garbage line
user_pref("another.key", 42);`;

      mockedReadFileSync.mockReturnValue(prefsContent);

      const result = parseFirefoxPrefs("/fake/profile");

      expect(result["valid.key"]).toBe("valid_value");
      expect(result["another.key"]).toBe(42);
    });
  });

  describe("getFirefoxVersion", () => {
    it("should return Firefox version string", () => {
      mockedExecSync.mockReturnValue(
        "Mozilla Firefox 120.0" as unknown as Buffer,
      );

      const result = getFirefoxVersion();

      expect(result).toBe("Mozilla Firefox 120.0");
    });

    it("should return fallback string when firefox command fails", () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error("Command not found");
      });

      const result = getFirefoxVersion();

      expect(result).toBe("Firefox (version unknown)");
    });
  });

  describe("getDefaultFonts", () => {
    it("should return an array of font names", () => {
      const fonts = getDefaultFonts();

      expect(Array.isArray(fonts)).toBe(true);
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts).toContain("Arial");
      expect(fonts).toContain("Helvetica");
      expect(fonts).toContain("Times New Roman");
      expect(fonts).toContain("Courier New");
    });

    it("should include Windows-specific fonts on win32", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      Object.defineProperty(process, "platform", { value: "win32" });

      const fonts = getDefaultFonts();

      expect(fonts).toContain("Segoe UI");
      expect(fonts).toContain("Tahoma");
      expect(fonts).toContain("Trebuchet MS");

      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    });

    it("should not include Windows-specific fonts on linux", () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        "platform",
      );
      Object.defineProperty(process, "platform", { value: "linux" });

      const fonts = getDefaultFonts();

      expect(fonts).not.toContain("Segoe UI");
      expect(fonts).not.toContain("Tahoma");

      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    });
  });

  describe("extractFingerprint", () => {
    it("should extract fingerprint from profile path", async () => {
      const prefsContent = `user_pref("intl.accept_languages", "en-GB,es");
user_pref("general.useragent.locale", "en-GB");`;

      mockedReadFileSync.mockReturnValue(prefsContent);
      mockedExecSync.mockReturnValue(
        "Mozilla Firefox 120.0" as unknown as Buffer,
      );

      const fingerprint = await extractFingerprint("/fake/profile");

      expect(fingerprint.browser).toBe("Firefox");
      expect(fingerprint.language).toBe("en-GB");
      expect(fingerprint.languages).toEqual(["en-GB", "es"]);
      expect(fingerprint.locale).toBe("en-GB");
      expect(fingerprint.hardwareConcurrency).toBe(os.cpus().length);
      expect(fingerprint.screen).toEqual({
        width: 1920,
        height: 1080,
        colorDepth: 24,
      });
      expect(fingerprint.plugins).toHaveLength(1);
      expect(fingerprint.plugins[0].name).toBe("PDF Viewer");
      expect(fingerprint.extractedAt).toBeDefined();
      expect(fingerprint.systemInfo.arch).toBe(os.arch());
    });

    it("should use defaults when prefs.js is missing", async () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockedExecSync.mockImplementation(() => {
        throw new Error("Not found");
      });

      const fingerprint = await extractFingerprint("/missing/profile");

      expect(fingerprint.language).toBe("en-GB");
      expect(fingerprint.locale).toBe("en-GB");
      expect(fingerprint.systemInfo.firefoxVersion).toBe(
        "Firefox (version unknown)",
      );
    });
  });

  describe("extractCookies", () => {
    const createMockSQL = (rows: unknown[][] = []) => {
      const mockDb = {
        exec: jest.fn().mockReturnValue(
          rows.length > 0
            ? [
                {
                  columns: [
                    "name",
                    "value",
                    "host",
                    "path",
                    "isSecure",
                    "isHttpOnly",
                    "sameSite",
                    "expiry",
                  ],
                  values: rows,
                },
              ]
            : [],
        ),
        close: jest.fn(),
      };
      return {
        Database: jest.fn().mockReturnValue(mockDb),
      };
    };

    it("should return empty array when cookies.sqlite does not exist", () => {
      mockedExistsSync.mockReturnValue(false);

      const result = extractCookies(
        "/fake/profile",
        createMockSQL(),
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });

    it("should extract vinted cookies from database", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db-data"));

      const mockRows = [
        [
          "session_id",
          "abc123",
          ".vinted.es",
          "/",
          1,
          1,
          0,
          1700000000,
        ],
        [
          "tracking",
          "xyz",
          ".google.com",
          "/",
          0,
          0,
          1,
          1700000000,
        ],
      ];

      const result = extractCookies(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("session_id");
      expect(result[0].value).toBe("abc123");
      expect(result[0].domain).toBe(".vinted.es");
      expect(result[0].secure).toBe(true);
      expect(result[0].httpOnly).toBe(true);
      expect(result[0].sameSite).toBe("None");
    });

    it("should normalize cookie domains", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db-data"));

      const mockRows = [
        [
          "test_cookie",
          "value",
          ".www.vinted.es",
          "/",
          0,
          0,
          "Lax",
          1700000000,
        ],
      ];

      const result = extractCookies(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].domain).toBe(".vinted.es");
    });

    it("should handle sameSite string values", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db-data"));

      const mockRows = [
        [
          "strict_cookie",
          "val",
          ".vinted.es",
          "/",
          1,
          0,
          "Strict",
          null,
        ],
      ];

      const result = extractCookies(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].sameSite).toBe("Strict");
      expect(result[0].expires).toBeUndefined();
    });

    it("should return empty array when SQL query returns no results", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db-data"));

      const result = extractCookies(
        "/fake/profile",
        createMockSQL([]),
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });

    it("should handle database read errors gracefully", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const mockSQL = {
        Database: jest.fn().mockImplementation(() => {
          throw new Error("Failed to open database");
        }),
      };

      const result = extractCookies(
        "/fake/profile",
        mockSQL,
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });
  });

  describe("extractLocalStorage", () => {
    const createMockSQL = (rows: unknown[][] = []) => {
      const mockDb = {
        exec: jest.fn().mockReturnValue(
          rows.length > 0
            ? [{ columns: ["key", "value"], values: rows }]
            : [],
        ),
        close: jest.fn(),
      };
      return {
        Database: jest.fn().mockReturnValue(mockDb),
      };
    };

    it("should return empty array when storage directory does not exist", () => {
      mockedExistsSync.mockReturnValue(false);

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(),
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });

    it("should extract auth-related localStorage items from vinted origins", () => {
      // First call: storageDir exists
      // Second call: data.sqlite exists
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir exists
        .mockReturnValueOnce(true); // data.sqlite exists

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const mockRows = [
        ["user_session_token", "tok123"],
        ["auth_refresh_key", "ref456"],
        [
          "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34",
          "hash-value",
        ], // hex string >=64 chars
        ["unrelated_preference", "dark_mode"],
      ];

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].origin).toContain("vinted.es");
      // Should only include auth-related keys
      const names = result[0].localStorage!.map((item) => item.name);
      expect(names).toContain("user_session_token");
      expect(names).toContain("auth_refresh_key");
      // Should exclude hex hash and unrelated preference
      expect(names).not.toContain(
        "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34",
      );
      expect(names).not.toContain("unrelated_preference");
    });

    it("should skip non-vinted origins", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "https+++www.google.com^" as unknown as import("fs").Dirent,
      ]);

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL([["session_token", "abc"]]),
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });

    it("should handle errors reading individual origin databases", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("Corrupt database");
      });

      const mockSQL = {
        Database: jest.fn().mockImplementation(() => {
          throw new Error("Invalid database");
        }),
      };

      const result = extractLocalStorage(
        "/fake/profile",
        mockSQL,
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });
  });

  describe("extractSessionStorage", () => {
    const createMockSQL = (rows: unknown[][] = []) => {
      const mockDb = {
        exec: jest.fn().mockReturnValue(
          rows.length > 0
            ? [{ columns: ["key", "value"], values: rows }]
            : [],
        ),
        close: jest.fn(),
      };
      return {
        Database: jest.fn().mockReturnValue(mockDb),
      };
    };

    it("should return empty array when storage directory does not exist", () => {
      mockedExistsSync.mockReturnValue(false);

      const result = extractSessionStorage(
        "/fake/profile",
        createMockSQL(),
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });

    it("should extract all sessionStorage items from vinted origins", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const mockRows = [
        ["page_state", "browsing"],
        ["csrf_token", "xyz789"],
      ];

      const result = extractSessionStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].origin).toContain("vinted.es");
      expect(result[0].sessionStorage).toHaveLength(2);
      expect(result[0].sessionStorage![0].name).toBe("page_state");
      expect(result[0].sessionStorage![1].name).toBe("csrf_token");
    });

    it("should skip origins without data", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite exists

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const result = extractSessionStorage(
        "/fake/profile",
        createMockSQL([]), // no rows
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });

    it("should handle errors reading individual session databases", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("Corrupt database");
      });

      const mockSQL = {
        Database: jest.fn().mockImplementation(() => {
          throw new Error("Invalid database");
        }),
      };

      const result = extractSessionStorage(
        "/fake/profile",
        mockSQL,
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });

    it("should skip non-vinted origins", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([
        "https+++www.google.com^" as unknown as import("fs").Dirent,
      ]);

      const result = extractSessionStorage(
        "/fake/profile",
        createMockSQL([["key", "val"]]),
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });
  });

  describe("getVintedHostname (tested indirectly through extractCookies)", () => {
    const createMockSQL = (rows: unknown[][] = []) => {
      const mockDb = {
        exec: jest.fn().mockReturnValue(
          rows.length > 0
            ? [
                {
                  columns: [
                    "name",
                    "value",
                    "host",
                    "path",
                    "isSecure",
                    "isHttpOnly",
                    "sameSite",
                    "expiry",
                  ],
                  values: rows,
                },
              ]
            : [],
        ),
        close: jest.fn(),
      };
      return {
        Database: jest.fn().mockReturnValue(mockDb),
      };
    };

    it("should handle invalid URL by falling back to vinted.com", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db-data"));

      const mockRows = [
        ["cookie1", "val", ".vinted.com", "/", 0, 0, 0, null],
      ];

      const result = extractCookies(
        "/fake/profile",
        createMockSQL(mockRows),
        "not-a-valid-url",
      );

      // Should match vinted.com since the fallback is "vinted.com"
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("cookie1");
    });

    it("should strip www. prefix from URL hostname", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db-data"));

      const mockRows = [
        ["cookie1", "val", ".vinted.fr", "/", 0, 0, 0, null],
      ];

      const result = extractCookies(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.fr",
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("normalizeCookieDomain (tested indirectly through extractCookies)", () => {
    const createMockSQL = (rows: unknown[][] = []) => {
      const mockDb = {
        exec: jest.fn().mockReturnValue(
          rows.length > 0
            ? [
                {
                  columns: [
                    "name",
                    "value",
                    "host",
                    "path",
                    "isSecure",
                    "isHttpOnly",
                    "sameSite",
                    "expiry",
                  ],
                  values: rows,
                },
              ]
            : [],
        ),
        close: jest.fn(),
      };
      return {
        Database: jest.fn().mockReturnValue(mockDb),
      };
    };

    it("should normalize www.vinted.es to .vinted.es", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db-data"));

      const mockRows = [
        ["cookie1", "val", "www.vinted.es", "/", 0, 0, 0, null],
      ];

      const result = extractCookies(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].domain).toBe(".vinted.es");
    });
  });

  describe("convertValue (tested indirectly through extractLocalStorage)", () => {
    const createMockSQL = (rows: unknown[][] = []) => {
      const mockDb = {
        exec: jest.fn().mockReturnValue(
          rows.length > 0
            ? [{ columns: ["key", "value"], values: rows }]
            : [],
        ),
        close: jest.fn(),
      };
      return {
        Database: jest.fn().mockReturnValue(mockDb),
      };
    };

    it("should convert object with numeric keys to string (char codes)", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      // Object with numeric keys representing char codes for "Hi"
      const charCodeObj = { "0": 72, "1": 105 };
      const mockRows = [["user_session_data", charCodeObj]];

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].localStorage![0].value).toBe("Hi");
    });

    it("should JSON-stringify non-string, non-numeric-object values", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const complexObj = { foo: "bar", baz: 42 };
      const mockRows = [["auth_token_data", complexObj]];

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].localStorage![0].value).toBe(
        JSON.stringify(complexObj),
      );
    });

    it("should handle number values by JSON-stringifying them", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const mockRows = [["session_count", 42]];

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].localStorage![0].value).toBe("42");
    });

    it("should pass through string values unchanged", () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // storageDir
        .mockReturnValueOnce(true); // data.sqlite

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const mockRows = [["user_access_token", "my-token-value"]];

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      expect(result[0].localStorage![0].value).toBe("my-token-value");
    });
  });

  describe("isAuthRelatedStorage (tested indirectly through extractLocalStorage)", () => {
    const createMockSQL = (rows: unknown[][] = []) => {
      const mockDb = {
        exec: jest.fn().mockReturnValue(
          rows.length > 0
            ? [{ columns: ["key", "value"], values: rows }]
            : [],
        ),
        close: jest.fn(),
      };
      return {
        Database: jest.fn().mockReturnValue(mockDb),
      };
    };

    it("should include keys containing auth-related keywords", () => {
      mockedExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const mockRows = [
        ["my_session_id", "s1"],
        ["oauth_token", "t1"],
        ["auth_state", "a1"],
        ["current_user", "u1"],
        ["refresh_token", "r1"],
        ["access_key", "ak1"],
      ];

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toHaveLength(1);
      const names = result[0].localStorage!.map((i) => i.name);
      expect(names).toContain("my_session_id");
      expect(names).toContain("oauth_token");
      expect(names).toContain("auth_state");
      expect(names).toContain("current_user");
      expect(names).toContain("refresh_token");
      expect(names).toContain("access_key");
    });

    it("should exclude long hex strings (64+ chars)", () => {
      mockedExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);

      mockedReaddirSync.mockReturnValue([
        "https+++www.vinted.es^" as unknown as import("fs").Dirent,
      ]);
      mockedReadFileSync.mockReturnValue(Buffer.from("fake-db"));

      const hexKey =
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      const mockRows = [[hexKey, "some-value"]];

      const result = extractLocalStorage(
        "/fake/profile",
        createMockSQL(mockRows),
        "https://www.vinted.es",
      );

      expect(result).toEqual([]);
    });
  });

  describe("extractFirefoxProfileData", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should orchestrate full extraction and return ExtractionData", async () => {
      // Mock prefs.js reading for extractFingerprint
      const prefsContent = `user_pref("intl.accept_languages", "en-GB");
user_pref("general.useragent.locale", "en-GB");`;

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const pathStr = String(filePath);
        if (pathStr.endsWith("prefs.js")) {
          return prefsContent;
        }
        return Buffer.from("fake-db-data");
      });

      mockedExecSync.mockReturnValue(
        "Mozilla Firefox 120.0" as unknown as Buffer,
      );

      // Mock cookies.sqlite exists
      mockedExistsSync.mockImplementation((p: any) => {
        const pathStr = String(p);
        return (
          pathStr.includes("cookies.sqlite") ||
          pathStr.includes("storage/default")
        );
      });

      // No storage origins
      mockedReaddirSync.mockReturnValue([]);

      // Mock sql.js require
      const mockDb = {
        exec: jest.fn().mockReturnValue([]),
        close: jest.fn(),
      };
      jest.mock("sql.js", () => jest.fn().mockResolvedValue({
        Database: jest.fn().mockReturnValue(mockDb),
      }), { virtual: true });

      const result = await extractFirefoxProfileData(
        "/fake/profile",
        "https://www.vinted.es",
      );

      expect(result.fingerprint).toBeDefined();
      expect(result.fingerprint.browser).toBe("Firefox");
      expect(result.authentication).toBeDefined();
      expect(result.authentication.cookies).toBeDefined();
      expect(result.authentication.origins).toBeDefined();
    });

    it("should handle gracefully when sub-extractors fail and return empty data", async () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      mockedExecSync.mockImplementation(() => {
        throw new Error("Command not found");
      });

      mockedExistsSync.mockReturnValue(false);

      const result = await extractFirefoxProfileData("/nonexistent/profile");

      // The function catches internal errors and still returns a result
      expect(result.fingerprint).toBeDefined();
      expect(result.fingerprint.language).toBe("en-GB");
      expect(result.authentication.cookies).toEqual([]);
      expect(result.authentication.origins).toEqual([]);
    });
  });
});
