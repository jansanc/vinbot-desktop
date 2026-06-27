import { saveFirefoxExtractionData, AuthData } from "../../../../modules/vinted/auth/vintedAuth.service";
import type { Fingerprint } from "../../../../types";

describe("vintedAuth.service", () => {
  const mockFingerprint: Fingerprint = {
    extractedAt: "2024-01-01T00:00:00.000Z",
    browser: "Firefox",
    source: "Extracted from Firefox profile and system settings",
    userAgent: "Mozilla/5.0 (Win32) Firefox/120.0",
    language: "en-GB",
    languages: ["en-GB", "es"],
    platform: "Win32",
    timezone: "Europe/Madrid",
    locale: "en-GB",
    screen: { width: 1920, height: 1080, colorDepth: 24 },
    hardwareConcurrency: 8,
    deviceMemory: 16,
    installedFonts: ["Arial", "Helvetica"],
    plugins: [{ name: "PDF Viewer", description: "Portable Document Format" }],
    systemInfo: {
      platform: "win32",
      arch: "x64",
      firefoxVersion: "Mozilla Firefox 120.0",
    },
  };

  const mockAuthData: AuthData = {
    cookies: [
      {
        name: "session_id",
        value: "abc123",
        domain: ".vinted.es",
        path: "/",
        expires: 1700000000,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
    ],
    origins: [
      {
        origin: "https://www.vinted.es",
        localStorage: [{ name: "token", value: "tok123" }],
      },
    ],
  };

  describe("saveFirefoxExtractionData", () => {
    it("should throw an error indicating database saving is not configured", async () => {
      await expect(
        saveFirefoxExtractionData(
          "user@vinted.es",
          mockFingerprint,
          mockAuthData,
          "admin@company.com",
          "12345",
        ),
      ).rejects.toThrow(
        "Database saving not configured. Please implement Supabase integration.",
      );
    });

    it("should log the extraction parameters before throwing", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      try {
        await saveFirefoxExtractionData(
          "user@vinted.es",
          mockFingerprint,
          mockAuthData,
          "admin@company.com",
          "12345",
        );
      } catch {
        // Expected to throw
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        "saveFirefoxExtractionData called but not implemented",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          vintedEmail: "user@vinted.es",
          userEmail: "admin@company.com",
          vintedMemberId: "12345",
          fingerprintKeys: expect.arrayContaining(["browser", "platform"]),
          cookiesCount: 1,
        }),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("AuthData interface", () => {
    it("should accept valid AuthData with localStorage and sessionStorage", () => {
      const authData: AuthData = {
        cookies: [],
        origins: [
          {
            origin: "https://www.vinted.es",
            localStorage: [{ name: "key", value: "val" }],
            sessionStorage: [{ name: "sess", value: "data" }],
          },
        ],
      };

      expect(authData.cookies).toHaveLength(0);
      expect(authData.origins).toHaveLength(1);
      expect(authData.origins[0].localStorage).toHaveLength(1);
      expect(authData.origins[0].sessionStorage).toHaveLength(1);
    });

    it("should accept AuthData with optional storage fields omitted", () => {
      const authData: AuthData = {
        cookies: [
          {
            name: "test",
            value: "val",
            domain: ".vinted.es",
            path: "/",
            httpOnly: false,
            secure: true,
            sameSite: "Lax",
          },
        ],
        origins: [{ origin: "https://www.vinted.es" }],
      };

      expect(authData.cookies[0].expires).toBeUndefined();
      expect(authData.origins[0].localStorage).toBeUndefined();
      expect(authData.origins[0].sessionStorage).toBeUndefined();
    });
  });
});
