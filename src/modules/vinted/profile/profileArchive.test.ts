import { describe, expect, it } from "vitest";
import { archiveNamePart, includeInProfileArchive } from "./profileArchive";

describe("includeInProfileArchive", () => {
  it("keeps what carries the session", () => {
    for (const entry of [
      "vinted_login_1",
      "vinted_login_1/cookies.sqlite",
      "vinted_login_1/cookies.sqlite-wal",
      "vinted_login_1/storage/default/https+++www.vinted.es/ls/data.sqlite",
      "vinted_login_1/prefs.js",
    ]) {
      expect(includeInProfileArchive(entry), entry).toBe(true);
    }
  });

  it("drops caches and locks, at any depth", () => {
    for (const entry of [
      "vinted_login_1/cache2",
      "vinted_login_1/cache2/entries/ABC",
      "vinted_login_1/startupCache/startupCache.8.little",
      "vinted_login_1/parent.lock",
    ]) {
      expect(includeInProfileArchive(entry), entry).toBe(false);
    }
  });

  it("never lets saved passwords or history leave the machine", () => {
    for (const entry of [
      "vinted_login_1/logins.json",
      "vinted_login_1/key4.db",
      "vinted_login_1/places.sqlite",
      "vinted_login_1/places.sqlite-wal",
      "vinted_login_1\\formhistory.sqlite",
    ]) {
      expect(includeInProfileArchive(entry), entry).toBe(false);
    }
  });
});

describe("archiveNamePart", () => {
  it("can't point the archive outside the temp folder", () => {
    for (const name of ["../../etc/passwd", "C:\\Windows", "..", ".hidden"]) {
      const part = archiveNamePart(name);
      expect(part, name).not.toMatch(/[\\/:]/);
      expect(part, name).not.toMatch(/^\./);
    }
    expect(archiveNamePart("")).toBe("profile");
  });
});
