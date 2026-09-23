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
    // Certificate revocation data (CRLite), ~18 MB, re-downloaded by Firefox
    "security_state",
    "gmp",
    "gmp-gmpopenh264",
    "gmp-widevinecdm",
  ].map((d) => d.toLowerCase()),
);

/**
 * Paths (relative to the profile root) dropped as a whole. For folders whose
 * name alone is too generic to exclude everywhere.
 */
const EXCLUDED_PATHS = [
  // Firefox's own chrome-privileged IndexedDB: Remote Settings and similar
  // browser-internal data (~20 MB), re-synced by Firefox. Site storage lives
  // in storage/default and is kept.
  "storage/permanent/chrome",
].map((p) => p.toLowerCase());

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
 * tar's `filter`: true keeps the entry. Excluding a directory here also
 * excludes everything under it, since tar tests each entry it walks into.
 */
export function includeInProfileArchive(entryPath: string): boolean {
  const segments = entryPath.split(/[\/]/).filter(Boolean);

  // The first segment is the profile folder itself - always keep it.
  const relative = segments.slice(1).join("/").toLowerCase();
  if (EXCLUDED_PATHS.some((p) => relative === p || relative.startsWith(p + "/"))) {
    return false;
  }

  for (const segment of segments.slice(1)) {
    const name = segment.toLowerCase();
    if (EXCLUDED_DIRS.has(name)) return false;
    if (EXCLUDED_FILES.has(name)) return false;
  }

  return true;
}
