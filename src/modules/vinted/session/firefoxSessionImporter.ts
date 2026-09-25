import path from "path";
import os from "os";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "fs";
import * as tar from "tar";
import { archiveNamePart, includeInProfileArchive } from "../profile/profileArchive";
import type { InteractiveLoginResult, VintedCookie } from "./interactiveSessionExtractor";

/**
 * Import the Vinted session a user already has in their everyday Firefox, so
 * they don't have to log in again through the interactive login window.
 *
 * What gets uploaded is NOT the user's Firefox profile. That holds their
 * history, saved passwords and every other site's cookies, none of which is
 * ours to take. Instead a fresh, minimal profile is built holding only one
 * Vinted site's session (see importFirefoxSession for why just one):
 *   - cookies.sqlite, with every other cookie deleted
 *   - storage/default/<that site's origins>/ (local storage, IndexedDB)
 * Firefox rebuilds everything else in a profile on first start.
 *
 * Firefox may still be running while this reads. Its SQLite databases are in
 * WAL mode, so recent writes - very often the login itself - sit in
 * cookies.sqlite-wal rather than cookies.sqlite. sql.js can't read a WAL, so
 * applyWal() folds the committed frames into a copy of the database first.
 */

export interface FirefoxProfileCandidate {
  /** Folder name inside Profiles/ (or the absolute path for a non-relative profile). */
  id: string;
  /** Friendly name from profiles.ini / Firefox's profile manager. */
  name: string;
  path: string;
  /** Firefox opens this profile by default. */
  isDefault: boolean;
}

/**
 * A logged-in session on one Vinted site. Each site (vinted.es, vinted.com,
 * vinted.co.uk ...) is a separate account with its own tokens.
 */
export interface VintedSiteSession {
  /** The site without "www.", e.g. "vinted.es". */
  site: string;
  /** The Vinted user id (the token's subject). */
  userId?: string;
  /** When the logged-in refresh token expires (unix seconds). */
  expiresAt?: number;
}

export interface VintedSessionInfo {
  state: "logged-in" | "anonymous" | "none";
  /** Every site this profile is logged in to, most recently logged in first. */
  sites: VintedSiteSession[];
  cookieCount: number;
}

export interface FirefoxProfileSession extends FirefoxProfileCandidate {
  session: VintedSessionInfo;
  /** Set when the profile couldn't be read at all. */
  error?: string;
}

interface SqlJsDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  run(sql: string, params?: unknown[]): void;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

let sqlJs: Promise<SqlJsStatic> | null = null;
function loadSqlJs(): Promise<SqlJsStatic> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sqlJs ??= require("sql.js")();
  return sqlJs!;
}

function firefoxRoot(): string {
  return path.join(process.env.APPDATA || "", "Mozilla", "Firefox");
}

// ============================================================================
// PROFILE DISCOVERY
// ============================================================================

/** Parse an ini file into { section: { key: value } }. */
function parseIni(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = sections[header[1]] = {};
    } else if (current && line.includes("=")) {
      const eq = line.indexOf("=");
      current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return sections;
}

/**
 * Names from Firefox's newer profile manager ("Profile Groups"), which keeps
 * profiles it creates out of profiles.ini entirely.
 */
async function readProfileGroupNames(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const groupsDir = path.join(root, "Profile Groups");
  if (!existsSync(groupsDir)) return names;

  const SQL = await loadSqlJs();
  for (const file of readdirSync(groupsDir).filter((f) => f.endsWith(".sqlite"))) {
    try {
      const db = new SQL.Database(readSqliteWithWal(path.join(groupsDir, file)));
      try {
        const rows = db.exec("SELECT path, name FROM Profiles")[0]?.values ?? [];
        for (const [profilePath, name] of rows) {
          names.set(path.basename(String(profilePath)).toLowerCase(), String(name));
        }
      } finally {
        db.close();
      }
    } catch (e) {
      console.warn(`[FirefoxImport] Could not read ${file}: ${e}`);
    }
  }
  return names;
}

/**
 * Every Firefox profile that exists on disk. profiles.ini alone isn't enough:
 * it keeps entries for profiles whose folders are long gone, and misses those
 * created by the newer profile manager - so it's merged with a scan of
 * Profiles/.
 */
export async function listFirefoxProfiles(): Promise<FirefoxProfileCandidate[]> {
  const root = firefoxRoot();
  const profilesDir = path.join(root, "Profiles");
  const byPath = new Map<string, FirefoxProfileCandidate>();
  const key = (p: string) => path.resolve(p).toLowerCase();

  const add = (profilePath: string, name?: string, isDefault = false) => {
    if (!existsSync(path.join(profilePath, "prefs.js")) && !existsSync(path.join(profilePath, "cookies.sqlite"))) {
      return;
    }
    const existing = byPath.get(key(profilePath));
    if (existing) {
      if (name && existing.name === existing.id) existing.name = name;
      existing.isDefault ||= isDefault;
      return;
    }
    const id = path.dirname(profilePath) === profilesDir ? path.basename(profilePath) : profilePath;
    byPath.set(key(profilePath), { id, name: name || id, path: profilePath, isDefault });
  };

  const iniPath = path.join(root, "profiles.ini");
  if (existsSync(iniPath)) {
    const ini = parseIni(readFileSync(iniPath, "utf-8"));
    const resolve = (p: string, relative: boolean) => (relative ? path.join(root, p) : p);
    // [Install<hash>] Default= is the profile each Firefox install opens; the
    // older Default=1 on a [Profile<n>] only applies without one.
    const installDefaults = new Set(
      Object.entries(ini)
        .filter(([section, values]) => section.startsWith("Install") && values.Default)
        .map(([, values]) => key(resolve(values.Default, true)))
    );
    for (const [section, values] of Object.entries(ini)) {
      if (!section.startsWith("Profile") || !values.Path) continue;
      const profilePath = resolve(values.Path, values.IsRelative !== "0");
      const isDefault = installDefaults.size
        ? installDefaults.has(key(profilePath))
        : values.Default === "1";
      add(profilePath, values.Name, isDefault);
    }
    // An install default with no [Profile] entry (profile-manager profiles).
    for (const [section, values] of Object.entries(ini)) {
      if (section.startsWith("Install") && values.Default) add(resolve(values.Default, true), undefined, true);
    }
  }

  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) add(path.join(profilesDir, entry.name));
    }
  }

  const groupNames = await readProfileGroupNames(root);
  for (const profile of byPath.values()) {
    const groupName = groupNames.get(path.basename(profile.path).toLowerCase());
    if (groupName) profile.name = groupName;
  }

  // Firefox's own background-task profiles are never where the user logged in.
  return [...byPath.values()]
    .filter((p) => !/MozillaBackgroundTask/i.test(p.id))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

// ============================================================================
// SQLITE + WAL
// ============================================================================

/** SQLite's WAL checksum over `length` bytes (a multiple of 8) from `start`. */
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

// ============================================================================
// VINTED SESSION
// ============================================================================

/** Vinted's hosts: vinted.es, www.vinted.co.uk, .vinted.fr ... */
const VINTED_HOST = /(^|\.)vinted\.[a-z]{2,3}(\.[a-z]{2})?$/i;

/** SQL for the Vinted cookies in the default (non-container, non-partitioned) jar. */
const VINTED_COOKIES_WHERE =
  "(host LIKE '%vinted.%') AND (originAttributes IS NULL OR originAttributes = '')";

/** The Vinted site a cookie host belongs to: ".www.vinted.es" -> "vinted.es". */
export function vintedSiteOf(host: string): string {
  return host.toLowerCase().replace(/^\./, "").replace(/^www\./, "");
}

function toVintedCookie(row: unknown[]): VintedCookie | null {
  const [name, value, host, cookiePath, expiry, isSecure, isHttpOnly, sameSite] = row;
  if (!VINTED_HOST.test(String(host).replace(/^\./, ""))) return null;
  const secure = Number(isSecure) === 1;
  const expiryNumber = Number(expiry);
  const sameSiteNames: Record<number, VintedCookie["sameSite"]> = { 0: "None", 1: "Lax", 2: "Strict" };
  // Chromium drops SameSite=None cookies that aren't Secure; Firefox treats
  // those as Lax anyway.
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
}

async function openCookieDb(profilePath: string): Promise<SqlJsDatabase | null> {
  const dbPath = path.join(profilePath, "cookies.sqlite");
  if (!existsSync(dbPath)) return null;
  const SQL = await loadSqlJs();
  return new SQL.Database(readSqliteWithWal(dbPath));
}

function selectVintedCookies(db: SqlJsDatabase): VintedCookie[] {
  const rows =
    db.exec(
      "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE " +
        VINTED_COOKIES_WHERE
    )[0]?.values ?? [];
  return rows.map(toVintedCookie).filter((c): c is VintedCookie => c !== null);
}

/**
 * Which Vinted sites the cookies hold a logged-in, unexpired session for.
 *
 * Vinted hands every visitor access_token_web/refresh_token_web cookies, so
 * their presence proves nothing. They are JWTs, though: an anonymous one has
 * scope "public" and no subject; a logged-in one names the user.
 *
 * Only the refresh token counts: it is what the backend renews the session
 * with, and an access token alone expires within hours.
 */
export function describeVintedSession(cookies: VintedCookie[]): VintedSessionInfo {
  const info: VintedSessionInfo = { state: "none", sites: [], cookieCount: cookies.length };
  const issuedAt = new Map<string, number>();
  const now = Date.now() / 1000;

  for (const cookie of cookies) {
    if (cookie.name !== "refresh_token_web" && cookie.name !== "access_token_web") continue;
    if (info.state === "none") info.state = "anonymous";
    if (cookie.name !== "refresh_token_web") continue;
    try {
      const claims = JSON.parse(
        Buffer.from(cookie.value.split(".")[1] ?? "", "base64url").toString("utf8")
      );
      if (claims.exp && claims.exp < now) continue;
      if (!(claims.sub || (claims.scope && claims.scope !== "public"))) continue;

      const site = vintedSiteOf(cookie.domain);
      if (issuedAt.has(site) && issuedAt.get(site)! >= (claims.iat ?? 0)) continue;
      issuedAt.set(site, claims.iat ?? 0);
      info.sites = info.sites.filter((s) => s.site !== site);
      info.sites.push({
        site,
        userId: claims.sub ? String(claims.sub) : undefined,
        expiresAt: claims.exp,
      });
    } catch {
      // Not a JWT we can read; judge by the others.
    }
  }

  if (info.sites.length) info.state = "logged-in";
  info.sites.sort((a, b) => (issuedAt.get(b.site) ?? 0) - (issuedAt.get(a.site) ?? 0));
  return info;
}

/** Every Firefox profile, with what Vinted session (if any) each one holds. */
export async function findFirefoxVintedSessions(): Promise<FirefoxProfileSession[]> {
  const profiles = await listFirefoxProfiles();
  const results: FirefoxProfileSession[] = [];

  for (const profile of profiles) {
    try {
      const db = await openCookieDb(profile.path);
      let cookies: VintedCookie[] = [];
      if (db) {
        try {
          cookies = selectVintedCookies(db);
        } finally {
          db.close();
        }
      }
      results.push({ ...profile, session: describeVintedSession(cookies) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[FirefoxImport] Could not read ${profile.path}: ${msg}`);
      results.push({ ...profile, session: { state: "none", sites: [], cookieCount: 0 }, error: msg });
    }
  }

  // Logged-in profiles first, then Firefox's default.
  const rank = (p: FirefoxProfileSession) => (p.session.state === "logged-in" ? 0 : 1);
  return results.sort((a, b) => rank(a) - rank(b) || Number(b.isDefault) - Number(a.isDefault));
}

// ============================================================================
// IMPORT
// ============================================================================

/**
 * Copy a directory tree, skipping files Firefox holds locked rather than
 * failing on them - they are never the ones a session needs.
 */
function copyTreeTolerant(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    try {
      if (entry.isDirectory()) copyTreeTolerant(src, dest);
      else if (entry.isFile()) copyFileSync(src, dest);
    } catch (e) {
      console.warn(`[FirefoxImport] Skipped ${src}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/**
 * Copy a Vinted origin's storage folder. Each SQLite database in it is written
 * with its WAL already applied, so the copy is complete on its own.
 */
function copyOriginStorage(from: string, to: string): void {
  copyTreeTolerant(from, to);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".sqlite")) {
        const src = path.join(from, path.relative(to, full));
        try {
          writeFileSync(full, readSqliteWithWal(src));
          rmSync(`${full}-wal`, { force: true });
          rmSync(`${full}-shm`, { force: true });
        } catch (e) {
          console.warn(`[FirefoxImport] Could not merge WAL for ${src}: ${e}`);
        }
      }
    }
  };
  walk(to);
}

export interface FirefoxImportOptions {
  profilePath: string;
  profileName: string;
  /**
   * The Vinted site whose session to import, e.g. "vinted.es". Optional when
   * the profile is logged in to exactly one site.
   */
  site?: string;
}

/**
 * Build a single-site Vinted profile from the user's Firefox profile and
 * archive it. The result has the same shape as an interactive login's, so it
 * goes through the same upload and account-linking steps.
 *
 * Only the chosen site's cookies and storage go in. An everyday profile
 * usually holds several Vinted sites - other accounts, or anonymous visits -
 * and the engine takes the account's site from whichever Vinted auth cookie
 * it meets first. With the others included it opened a site the account
 * isn't logged in to, and Vinted answered 403 access_denied. A login through
 * "Log in with Firefox" never has this problem: its fresh profile only ever
 * visited one site.
 *
 * Throws when the profile holds no logged-in Vinted session: unlike the
 * interactive login there is nothing to lose by refusing, and uploading a
 * logged-out session would only link a dead account.
 */
export async function importFirefoxSession(options: FirefoxImportOptions): Promise<InteractiveLoginResult> {
  const { profilePath, profileName } = options;
  let site = options.site ? vintedSiteOf(options.site) : undefined;
  const startedAt = Date.now();

  if (!existsSync(path.join(profilePath, "cookies.sqlite"))) {
    throw new Error(`This Firefox profile has no cookies yet (${profilePath}).`);
  }

  const db = await openCookieDb(profilePath);
  if (!db) throw new Error(`Could not open cookies in ${profilePath}.`);

  const workDir = path.join(os.tmpdir(), `vinted_import_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const newProfile = path.join(workDir, "profile");
  mkdirSync(newProfile, { recursive: true });

  try {
    let cookies: VintedCookie[];
    try {
      const allCookies = selectVintedCookies(db);
      const session = describeVintedSession(allCookies);
      if (session.state !== "logged-in") {
        throw new Error(
          session.state === "anonymous"
            ? "This Firefox profile isn't logged in to Vinted (or its session expired). " +
                "Open Vinted in Firefox and log in, or use \"Log in with Firefox\" instead."
            : "No Vinted session found in this Firefox profile. " +
                "Open Vinted in Firefox and log in, or use \"Log in with Firefox\" instead."
        );
      }
      if (!site) {
        if (session.sites.length > 1) {
          throw new Error(
            `This Firefox profile is logged in to several Vinted sites (${session.sites.map((s) => s.site).join(", ")}). Choose which one to import.`
          );
        }
        site = session.sites[0].site;
      }
      const chosen = session.sites.find((s) => s.site === site);
      if (!chosen) {
        throw new Error(
          `This Firefox profile isn't logged in to ${site} (or that session expired). ` +
            `Open ${site} in Firefox and log in, then refresh the list.`
        );
      }
      console.log(`[FirefoxImport] Importing the ${site} session (user ${chosen.userId ?? "?"})`);

      // cookies.sqlite with only that site's cookies left in it.
      cookies = allCookies.filter((c) => vintedSiteOf(c.domain) === site);
      const hosts = [...new Set(cookies.map((c) => c.domain))];
      db.run(
        `DELETE FROM moz_cookies WHERE NOT (${VINTED_COOKIES_WHERE} AND host IN (${hosts.map(() => "?").join(", ")}))`,
        hosts
      );
      db.run("VACUUM");
      writeFileSync(path.join(newProfile, "cookies.sqlite"), Buffer.from(db.export()));
    } finally {
      db.close();
    }

    // Vinted's local storage / IndexedDB, default context only (containers
    // and partitioned third-party storage carry a "^" suffix).
    const storageDir = path.join(profilePath, "storage", "default");
    if (existsSync(storageDir)) {
      for (const origin of readdirSync(storageDir)) {
        const host = origin.match(/^https?\+\+\+([^^+]+?)(\+\d+)?$/)?.[1];
        if (!host || !VINTED_HOST.test(host) || vintedSiteOf(host) !== site) continue;
        copyOriginStorage(path.join(storageDir, origin), path.join(newProfile, "storage", "default", origin));
      }
    }

    const archivePath = path.join(os.tmpdir(), `vinted_import_${archiveNamePart(profileName)}_${Date.now()}.tar.gz`);
    await tar.create(
      { gzip: true, file: archivePath, cwd: workDir, filter: includeInProfileArchive },
      [path.basename(newProfile)]
    );
    const archiveSize = statSync(archivePath).size;
    console.log(
      `[FirefoxImport] Vinted-only profile archived: ${(archiveSize / 1024).toFixed(1)}KB, ${cookies.length} cookie(s)`
    );

    const now = Date.now();
    return {
      profile_name: profileName,
      profile_path: profilePath,
      url: "",
      profile_archive_path: archivePath,
      profile_archive_size: archiveSize,
      extracted_at: now,
      loginDuration: now - startedAt,
      compressed_at: now,
      vinted_login: "logged-in",
      vinted_cookies: cookies,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
