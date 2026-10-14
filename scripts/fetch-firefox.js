#!/usr/bin/env node
/**
 * Download the Firefox the app ships with into vendor/firefox, for the
 * platform this runs on (each installer is built on its own OS: see
 * .github/workflows/build.yml). electron-builder copies it into the app's
 * resources (extraResources), and the login window uses it before any
 * Firefox the user may have installed, so users don't need one.
 *
 *   node scripts/fetch-firefox.js            latest release
 *   FIREFOX_VERSION=158.0 node scripts/...   a given one
 *
 * Mozilla's official build, checked against its published SHA-512 sums.
 * Skipped when vendor/firefox already holds the wanted version.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const VENDOR_DIR = path.join(__dirname, "..", "vendor", "firefox");
const RELEASES = "https://download-installer.cdn.mozilla.net/pub/firefox/releases";

/** The bundled copy never updates itself (it would rewrite files inside the
 *  app); each app release ships a current Firefox instead. Windows only: on
 *  macOS this file would break Mozilla's signature on Firefox.app, and the
 *  login profile's prefs already turn automatic updates off. */
const POLICIES = {
  policies: {
    DisableAppUpdate: true,
    DisableTelemetry: true,
    DisableFirefoxStudies: true,
    DontCheckDefaultBrowser: true,
    OverrideFirstRunPage: "",
    OverridePostUpdatePage: "",
  },
};

const PLATFORMS = {
  win32: {
    file: (v) => `win64/en-US/Firefox Setup ${v}.exe`,
    executable: "firefox.exe",
  },
  darwin: {
    file: (v) => `mac/en-US/Firefox ${v}.dmg`,
    executable: path.join("Firefox.app", "Contents", "MacOS", "firefox"),
  },
};

async function latestVersion() {
  const res = await fetch("https://product-details.mozilla.org/1.0/firefox_versions.json");
  if (!res.ok) throw new Error(`Firefox versions: HTTP ${res.status}`);
  return (await res.json()).LATEST_FIREFOX_VERSION;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const out = fs.createWriteStream(dest);
  let received = 0;
  let shown = -1;
  for await (const chunk of res.body) {
    out.write(chunk);
    received += chunk.length;
    const pct = total ? Math.floor((received / total) * 100) : 0;
    if (pct >= shown + 10) {
      shown = pct;
      process.stdout.write(`  ${pct}%`);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  process.stdout.write("\n");
}

async function verify(file, version, relativePath) {
  const res = await fetch(`${RELEASES}/${version}/SHA512SUMS`);
  if (!res.ok) throw new Error(`SHA512SUMS: HTTP ${res.status}`);
  const line = (await res.text()).split("\n").find((l) => l.endsWith(`  ${relativePath}`));
  if (!line) throw new Error(`No checksum published for ${relativePath}`);
  const expected = line.split(/\s+/)[0];
  const actual = crypto.createHash("sha512").update(fs.readFileSync(file)).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${relativePath}: the download is corrupt or tampered with`);
}

/**
 * What a login window never uses, dropped from the Windows copy (~45 MB):
 * the updater and maintenance service (it never updates itself), crash
 * reporting, the default-browser agent and other OS integration helpers, the
 * uninstaller, DirectX's shader compiler (WebGPU only), and the on-device AI
 * runtime (translations and other local-AI features, off in the login profile).
 * Firefox loads none of these to show a page; checked by running the login.
 */
const WINDOWS_UNUSED = [
  "updater.exe",
  "updater.ini",
  "update-settings.ini",
  "maintenanceservice.exe",
  "maintenanceservice_installer.exe",
  "crashreporter.exe",
  "crashhelper.exe",
  "minidump-analyzer.exe",
  "pingsender.exe",
  "default-browser-agent.exe",
  "notification-helper.exe",
  "nmhproxy.exe",
  "private_browsing.exe",
  "uninstall",
  "dxcompiler.dll",
  "onnxruntime.dll",
  "mozinference.dll",
];

function extractWindows(installer, dest) {
  // The installer is a 7-Zip archive; the browser is its core/ folder
  const sevenZip = require("7zip-bin").path7za;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "firefox-extract-"));
  try {
    execFileSync(sevenZip, ["x", installer, `-o${tmp}`, "-y"], { stdio: "ignore" });
    fs.cpSync(path.join(tmp, "core"), dest, { recursive: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const unused of WINDOWS_UNUSED) fs.rmSync(path.join(dest, unused), { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, "distribution"), { recursive: true });
  fs.writeFileSync(path.join(dest, "distribution", "policies.json"), JSON.stringify(POLICIES, null, 2));
}

function extractMac(dmg, dest) {
  // ditto keeps the bundle exactly as Mozilla signed it
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), "firefox-dmg-"));
  execFileSync("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-mountpoint", mount], { stdio: "ignore" });
  try {
    fs.mkdirSync(dest, { recursive: true });
    execFileSync("ditto", [path.join(mount, "Firefox.app"), path.join(dest, "Firefox.app")]);
  } finally {
    execFileSync("hdiutil", ["detach", mount, "-quiet"]);
  }
}

async function main() {
  const platform = PLATFORMS[process.platform];
  if (!platform) {
    console.log(`[firefox] No bundled Firefox for ${process.platform}; the app will use the system one`);
    return;
  }

  const version = process.env.FIREFOX_VERSION || (await latestVersion());
  const versionFile = path.join(VENDOR_DIR, "VERSION");
  if (
    fs.existsSync(path.join(VENDOR_DIR, platform.executable)) &&
    fs.existsSync(versionFile) &&
    fs.readFileSync(versionFile, "utf8").trim() === version
  ) {
    console.log(`[firefox] Firefox ${version} already in vendor/firefox`);
    return;
  }

  const relativePath = platform.file(version);
  const url = `${RELEASES}/${version}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  const download_ = path.join(os.tmpdir(), path.basename(relativePath));
  console.log(`[firefox] Downloading Firefox ${version} (${relativePath})`);
  await download(url, download_);
  try {
    await verify(download_, version, relativePath);
    fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
    if (process.platform === "win32") extractWindows(download_, VENDOR_DIR);
    else extractMac(download_, VENDOR_DIR);
    fs.writeFileSync(versionFile, `${version}\n`);
  } finally {
    fs.rmSync(download_, { force: true });
  }
  console.log(`[firefox] Firefox ${version} ready in vendor/firefox`);
}

main().catch((err) => {
  console.error(`[firefox] ${err.message}`);
  process.exit(1);
});
