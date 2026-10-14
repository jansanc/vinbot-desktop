/**
 * What goes into a profile archive - and what never does.
 *
 * A browser profile folder is mostly cache: on a real Chrome profile the
 * caches are hundreds of megabytes while the part that carries the session
 * (cookies, local/session storage, IndexedDB, preferences) is a few MB. Tarring
 * the folder whole produced archives over the storage bucket's file size limit,
 * and the upload came back rejected with nothing the user could act on.
 *
 * None of the entries below are needed to restore a logged-in session: the
 * browser rebuilds every one of them on next start.
 *
 * Nothing is excluded by extension. LevelDB keeps recent local storage and
 * IndexedDB writes in `*.log`, and SQLite keeps committed cookies in `-wal`,
 * so dropping those would quietly cost the session part of its state.
 */

/** Directory names dropped wherever they appear in the profile tree. */
const EXCLUDED_DIRS = new Set(
  [
    // Chrome / Edge
    "cache",
    "code cache",
    "gpucache",
    "graphitedawncache",
    "grshadercache",
    "shadercache",
    "dawncache",
    "dawnwebgpucache",
    "media cache",
    "application cache",
    "cachestorage",
    "component_crx_cache",
    "extensions_crx_cache",
    "crashpad",
    "crash reports",
    "safe browsing",
    "optimization_guide_model_store",
    "optimization_guide_prediction_model_downloads",
    "segmentation_platform",
    "blob_storage",
    // Firefox
    "cache2",
    "startupcache",
    "shader-cache",
    "thumbnails",
    "safebrowsing",
    "minidumps",
    "crashes",
    "saved-telemetry-pings",
    "datareporting",
    "gmp",
    "gmp-gmpopenh264",
    "gmp-widevinecdm",
    // Firefox Suggest and other remote-settings data Firefox downloads on
    // its own (13+ MB on a fresh profile)
    "remote-settings",
  ].map((d) => d.toLowerCase()),
);

/**
 * Profile-relative folders dropped as a whole. storage/permanent/chrome is
 * Firefox's own IndexedDB (mostly its remote-settings cache, ~9 MB), not any
 * website's: Vinted's storage is under storage/default.
 */
const EXCLUDED_PATHS = ["storage/permanent/chrome"];

/**
 * Firefox databases it rebuilds by itself, matched with their SQLite side
 * files: Suggest's index, search categories, and the experiments (Nimbus)
 * database, which is named after a hash.
 */
const REBUILT_DATABASES = [/^suggest\.sqlite$/, /^domain_to_categories\.sqlite$/, /^[0-9a-f]{8}\.sqlite$/];

/** File names dropped wherever they appear. */
const EXCLUDED_FILES = new Set(
  [
    "parent.lock",
    "lock",
    "lockfile",
    ".parentlock",
    "singletonlock",
    "singletoncookie",
    "singletonsocket",
  ].map((f) => f.toLowerCase()),
);

/**
 * The user's private data, which must never leave the machine: none of it is
 * needed for a Vinted session. Firefox's logins.json + key4.db decrypt every
 * saved password offline (unless a primary password is set); Chrome's
 * "Login Data" / "Web Data" hold saved passwords, autofill and cards. History,
 * bookmarks and form history go too. Matched with their SQLite side files
 * ("-journal", "-wal", "-shm") - see isSensitiveFile.
 */
const SENSITIVE_FILES = new Set(
  [
    // Firefox
    "logins.json",
    "logins-backup.json",
    "logins.db",
    "key4.db",
    "key3.db",
    "signons.sqlite",
    "formhistory.sqlite",
    "places.sqlite",
    "favicons.sqlite",
    "autofill-profiles.json",
    // Chrome / Edge
    "login data",
    "login data for account",
    "web data",
    "history",
    "top sites",
    "visited links",
    "shortcuts",
    "bookmarks",
    "bookmarks.bak",
    "favicons",
    "network action predictor",
    "affiliation database",
  ].map((f) => f.toLowerCase()),
);

/** A SQLite file's name without its "-journal", "-wal" or "-shm" suffix. */
const databaseName = (name: string) => name.replace(/-(journal|wal|shm)$/, "");

function isSensitiveFile(name: string): boolean {
  return SENSITIVE_FILES.has(databaseName(name));
}

/**
 * tar's `filter`: true keeps the entry. Excluding a directory here also
 * excludes everything under it, since tar tests each entry it walks into.
 */
export function includeInProfileArchive(entryPath: string): boolean {
  const segments = entryPath.split(/[\\/]/).filter(Boolean);

  // The first segment is the profile folder itself - always keep it.
  const inProfile = segments.slice(1).map((s) => s.toLowerCase());
  const relative = inProfile.join("/");
  if (EXCLUDED_PATHS.some((p) => relative === p || relative.startsWith(`${p}/`))) return false;

  for (const name of inProfile) {
    if (EXCLUDED_DIRS.has(name)) return false;
    if (EXCLUDED_FILES.has(name)) return false;
    if (isSensitiveFile(name)) return false;
  }

  // Rebuilt databases only at the profile's top level, where Firefox keeps them
  if (inProfile.length === 1 && REBUILT_DATABASES.some((re) => re.test(databaseName(inProfile[0])))) {
    return false;
  }

  return true;
}

/**
 * A user-chosen name made safe to put in an archive's file name. The session
 * name is free text: a "/", "\", ":" or ".." in it would otherwise point the
 * archive path at a folder that doesn't exist, or outside the temp folder.
 */
export function archiveNamePart(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "_").slice(0, 80) || "profile";
}
