import { mkdtempSync, rmSync, statSync } from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasCompleteVintedLogin,
  readVintedCookies,
  vintedLoginState,
  type VintedCookie,
} from "./firefoxCookies";

/** An unsigned JWT with these claims; only the payload is ever read. */
const jwt = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

const now = Math.floor(Date.now() / 1000);
const anonymous = { scope: "public", exp: now + 3600 };
const user = { sub: "123456", scope: "user", exp: now + 3600 };

const cookie = (name: string, value: string): VintedCookie => ({
  name,
  value,
  domain: ".www.vinted.es",
  path: "/",
  expires: now + 3600,
  secure: true,
  httpOnly: true,
  sameSite: "Lax",
});

describe("vintedLoginState", () => {
  it("is unknown without Vinted tokens", () => {
    expect(vintedLoginState(null)).toBe("unknown");
    expect(vintedLoginState([cookie("anon_id", "x")])).toBe("unknown");
  });

  it("is anonymous with a visitor's tokens", () => {
    expect(vintedLoginState([cookie("access_token_web", jwt(anonymous))])).toBe("anonymous");
  });

  it("is logged in when a token names a user", () => {
    expect(
      vintedLoginState([cookie("refresh_token_web", jwt(anonymous)), cookie("access_token_web", jwt(user))])
    ).toBe("logged-in");
  });
});

describe("hasCompleteVintedLogin", () => {
  it("needs a user's refresh token", () => {
    expect(hasCompleteVintedLogin([cookie("refresh_token_web", jwt(user))])).toBe(true);
    // The access token alone expires within hours
    expect(hasCompleteVintedLogin([cookie("access_token_web", jwt(user))])).toBe(false);
    expect(hasCompleteVintedLogin([cookie("refresh_token_web", jwt(anonymous))])).toBe(false);
  });

  it("ignores an expired or unreadable refresh token", () => {
    expect(hasCompleteVintedLogin([cookie("refresh_token_web", jwt({ ...user, exp: now - 60 }))])).toBe(false);
    expect(hasCompleteVintedLogin([cookie("refresh_token_web", "not-a-jwt")])).toBe(false);
  });
});

describe("readVintedCookies", () => {
  let profile: string;
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    rmSync(profile, { recursive: true, force: true });
  });

  /** cookies.sqlite as Firefox keeps it: WAL mode, still open, nothing checkpointed. */
  const openFirefoxCookieDb = () => {
    profile = mkdtempSync(path.join(os.tmpdir(), "vinbot-cookies-test-"));
    db = new DatabaseSync(path.join(profile, "cookies.sqlite"));
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      CREATE TABLE moz_cookies (
        name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
        isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT
      );
    `);
    return db;
  };

  const insert = (name: string, value: string, host: string, originAttributes = "") =>
    db!
      .prepare("INSERT INTO moz_cookies VALUES (?, ?, ?, '/', ?, 1, 1, 1, ?)")
      .run(name, value, host, (now + 3600) * 1000, originAttributes);

  it("is null before Firefox has created the database", async () => {
    profile = mkdtempSync(path.join(os.tmpdir(), "vinbot-cookies-test-"));
    expect(await readVintedCookies(profile)).toBeNull();
  });

  it("sees a login Firefox has only written to the WAL", async () => {
    openFirefoxCookieDb();
    insert("refresh_token_web", jwt(user), ".www.vinted.es");
    insert("other_site", "x", ".example.com");
    // Partitioned (third-party) cookie: never part of the session
    insert("refresh_token_web", jwt(user), ".vinted.es", "^partitionKey=(https,example.com)");

    expect(statSync(path.join(profile, "cookies.sqlite-wal")).size).toBeGreaterThan(0);

    const cookies = await readVintedCookies(profile);
    expect(cookies).toEqual([
      {
        name: "refresh_token_web",
        value: jwt(user),
        domain: ".www.vinted.es",
        path: "/",
        // Firefox stores milliseconds; the backend wants seconds
        expires: now + 3600,
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    expect(hasCompleteVintedLogin(cookies)).toBe(true);
  });

  it("follows the login as it happens", async () => {
    openFirefoxCookieDb();
    insert("refresh_token_web", jwt(anonymous), ".www.vinted.es");
    expect(hasCompleteVintedLogin(await readVintedCookies(profile))).toBe(false);

    db!.prepare("UPDATE moz_cookies SET value = ? WHERE name = 'refresh_token_web'").run(jwt(user));
    expect(hasCompleteVintedLogin(await readVintedCookies(profile))).toBe(true);
  });
});
