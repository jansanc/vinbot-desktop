import path from "path";
import { existsSync, readFileSync } from "fs";

/**
 * Reading the Vinted cookies out of a Firefox profile, including one Firefox
 * still has open: that is how the login window knows the user is logged in
 * and closes itself.
 *
 * Firefox's SQLite databases are in WAL mode, so recent writes - very often
 * the login itself - sit in cookies.sqlite-wal rather than cookies.sqlite.
 * sql.js can't read a WAL, so applyWal() folds the committed frames into a
 * copy of the database first.
 */

/** A cookie in Playwright's storageState format, as the backend stores it. */
export interface VintedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds. */
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export type VintedLoginState = "logged-in" | "anonymous" | "unknown";

/** SQLite's WAL checksum over `length` bytes from `start`, continuing from s0/s1. */
function walChecksum(
  buf: Buffer,
  start: number,
  length: number,
  s0: number,
  s1: number,
  bigEndian: boolean
): [number, number] {
  for (let i = start; i < start + length; i += 8) {
    const x0 = bigEndian ? buf.readUInt32BE(i) : buf.readUInt32LE(i);
    const x1 = bigEndian ? buf.readUInt32BE(i + 4) : buf.readUInt32LE(i + 4);
    s0 = (s0 + x0 + s1) >>> 0;
    s1 = (s1 + x1 + s0) >>> 0;
  }
  return [s0, s1];
}

/**
 * The database as SQLite itself would see it: the main file with every
 * committed transaction in the WAL applied on top. Frames after the last
 * commit, from an older WAL generation (salt mismatch) or torn by a write in
 * progress (checksum mismatch) are ignored, exactly as SQLite does.
 * See https://www.sqlite.org/fileformat.html#the_write_ahead_log
 *
 * The result is marked as a rollback-journal database (header bytes 18-19) so
 * nothing tries to look for a WAL next to it.
 */
export function applyWal(db: Buffer, wal: Buffer | null): Buffer {
  let out = db;
  const magic = wal && wal.length >= 32 ? wal.readUInt32BE(0) : 0;

  if (wal && (magic === 0x377f0682 || magic === 0x377f0683)) {
    const bigEndian = magic === 0x377f0683;
    const pageSize = wal.readUInt32BE(8);
    const salt1 = wal.readUInt32BE(16);
    const salt2 = wal.readUInt32BE(20);
    let [s0, s1] = walChecksum(wal, 0, 24, 0, 0, bigEndian);

    if (s0 === wal.readUInt32BE(24) && s1 === wal.readUInt32BE(28)) {
      const committed = new Map<number, Buffer>();
      const pending = new Map<number, Buffer>();
      let dbPages = 0;

      for (let off = 32; off + 24 + pageSize <= wal.length; off += 24 + pageSize) {
        if (wal.readUInt32BE(off + 8) !== salt1 || wal.readUInt32BE(off + 12) !== salt2) break;
        [s0, s1] = walChecksum(wal, off, 8, s0, s1, bigEndian);
        [s0, s1] = walChecksum(wal, off + 24, pageSize, s0, s1, bigEndian);
        if (s0 !== wal.readUInt32BE(off + 16) || s1 !== wal.readUInt32BE(off + 20)) break;

        pending.set(wal.readUInt32BE(off), wal.subarray(off + 24, off + 24 + pageSize));
        const commitSize = wal.readUInt32BE(off + 4);
        if (commitSize) {
          pending.forEach((page, pgno) => committed.set(pgno, page));
          pending.clear();
          dbPages = commitSize;
        }
      }

      if (dbPages) {
        out = Buffer.alloc(dbPages * pageSize);
        db.copy(out, 0, 0, Math.min(db.length, out.length));
        committed.forEach((page, pgno) => {
          if (pgno <= dbPages) page.copy(out, (pgno - 1) * pageSize);
        });
      }
    }
  }

  if (out === db) out = Buffer.from(db);
  if (out.length >= 20) {
    out[18] = 1;
    out[19] = 1;
  }
  return out;
}

/** Read a (possibly open, WAL-mode) SQLite file, WAL included. */
function readSqliteWithWal(dbPath: string): Buffer {
  const walPath = `${dbPath}-wal`;
  // WAL first: a checkpoint between the two reads then only leaves frames
  // that are already in the main file, which is harmless.
  const wal = existsSync(walPath) ? readFileSync(walPath) : null;
  return applyWal(readFileSync(dbPath), wal);
}

let sqlJs: Promise<any> | null = null;

/**
 * The Vinted cookies in a Firefox profile, in Playwright's cookie format -
 * what the backend's browser engine bootstraps its own (Chromium) profile
 * from, since it cannot open a Firefox profile.
 *
 * Firefox keeps cookies unencrypted in cookies.sqlite, so they can be sent
 * as-is. Each cookie keeps the host Firefox stored it under: rewriting
 * .www.vinted.X to .vinted.X leaves a copy that shadows the tokens Vinted
 * rotates. Partitioned (third-party) cookies are left out.
 *
 * null when there is no cookies.sqlite yet or it can't be read.
 */
export async function readVintedCookies(profilePath: string): Promise<VintedCookie[] | null> {
  const dbPath = path.join(profilePath, "cookies.sqlite");
  if (!existsSync(dbPath)) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sqlJs ??= require("sql.js")();
    const SQL = await sqlJs;
    const db = new SQL.Database(readSqliteWithWal(dbPath));
    let rows: unknown[][];
    try {
      rows =
        db.exec(
          "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies " +
            "WHERE host LIKE '%vinted.%' AND (originAttributes IS NULL OR originAttributes = '')"
        )[0]?.values ?? [];
    } finally {
      db.close();
    }

    const sameSiteNames: Record<number, VintedCookie["sameSite"]> = { 0: "None", 1: "Lax", 2: "Strict" };
    return rows.map((row) => {
      const [name, value, host, cookiePath, expiry, isSecure, isHttpOnly, sameSite] = row;
      const secure = Number(isSecure) === 1;
      const expiryNumber = Number(expiry);
      // Chromium drops SameSite=None cookies that aren't Secure; Firefox
      // treats those as Lax anyway.
      let sameSiteName = sameSiteNames[Number(sameSite)] ?? "Lax";
      if (sameSiteName === "None" && !secure) sameSiteName = "Lax";
      return {
        name: String(name),
        value: String(value),
        domain: String(host),
        path: String(cookiePath || "/"),
        // Firefox 15x stores expiry in milliseconds, older ones in seconds.
        expires: expiryNumber > 1e11 ? Math.floor(expiryNumber / 1000) : expiryNumber,
        secure,
        httpOnly: Number(isHttpOnly) === 1,
        sameSite: sameSiteName,
      };
    });
  } catch (e) {
    // Right after launch the file exists before Firefox has created its
    // table: nothing to read yet, and nothing wrong
    if (/no such table/i.test(String(e))) return null;
    // A page torn mid-write while Firefox is running: the next read will do
    console.warn(`[FirefoxCookies] Could not read Vinted cookies: ${e}`);
    return null;
  }
}

/** A JWT's claims, or null when it isn't one we can read. */
function jwtClaims(token: string): Record<string, any> | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** A Vinted token that belongs to a user: an anonymous one has scope "public" and no subject. */
function isUserToken(claims: Record<string, any> | null): boolean {
  return Boolean(claims && (claims.sub || (claims.scope && claims.scope !== "public")));
}

/**
 * Whether the cookies hold a logged-in Vinted session.
 *
 * Vinted hands every visitor access_token_web/refresh_token_web cookies, so
 * their presence proves nothing. They are JWTs, though, and a logged-in one
 * names the user.
 */
export function vintedLoginState(cookies: VintedCookie[] | null): VintedLoginState {
  const tokens = (cookies ?? []).filter(
    (c) => c.name === "refresh_token_web" || c.name === "access_token_web"
  );
  if (!tokens.length) return "unknown";
  return tokens.some((t) => isUserToken(jwtClaims(t.value))) ? "logged-in" : "anonymous";
}

/**
 * Whether the login is done and the session complete enough to save: an
 * unexpired refresh token for a user. Stricter than vintedLoginState, as it
 * decides when the login window closes on its own - the refresh token is what
 * the backend renews the session with, and an access token alone expires
 * within hours.
 */
export function hasCompleteVintedLogin(cookies: VintedCookie[] | null): boolean {
  const now = Date.now() / 1000;
  return (cookies ?? []).some((c) => {
    if (c.name !== "refresh_token_web") return false;
    const claims = jwtClaims(c.value);
    return isUserToken(claims) && !(claims!.exp && claims!.exp < now);
  });
}
