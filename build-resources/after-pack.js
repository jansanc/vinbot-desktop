// electron-builder afterPack.
//
// Windows: drop what Electron ships that this app never uses. dxcompiler.dll
// and dxil.dll are DirectX's shader compiler, which Chromium loads only for
// WebGPU on Windows (~26 MB). The window is a plain React page; nothing in it
// uses WebGPU.
//
// macOS: check the app really runs on the oldest macOS it claims
// (mac.minimumSystemVersion). That number only tells macOS which versions may
// open the app; if Electron or the bundled Firefox needs a newer one, the app
// still installs there, then fails to start or to open the login. That
// happens when Electron or Firefox drops an old macOS: the build fails here
// instead.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const UNUSED_WINDOWS_FILES = ["dxcompiler.dll", "dxil.dll"];

/** -1, 0 or 1, comparing dotted versions ("10.15" < "12.0") */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** The newest minimum macOS among a binary's architectures (its LC_BUILD_VERSION) */
function binaryMinimumMacOS(binary) {
  const out = execFileSync("otool", ["-l", binary], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const versions = [...out.matchAll(/^\s*minos\s+([\d.]+)/gm)].map((m) => m[1]);
  return versions.length ? versions.sort(compareVersions).pop() : null;
}

function plistMinimumMacOS(plist) {
  try {
    return execFileSync("plutil", ["-extract", "LSMinimumSystemVersion", "raw", "-o", "-", plist], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function checkMacMinimum(context) {
  const claimed = context.packager.platformSpecificBuildOptions.minimumSystemVersion;
  if (!claimed) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  const needs = [
    [
      "Electron",
      binaryMinimumMacOS(path.join(app, "Contents/Frameworks/Electron Framework.framework/Electron Framework")),
      "use an Electron version that supports it (electronVersion)",
    ],
  ];
  const firefoxPlist = path.join(app, "Contents/Resources/firefox/Firefox.app/Contents/Info.plist");
  if (fs.existsSync(firefoxPlist)) {
    needs.push([
      "The bundled Firefox",
      plistMinimumMacOS(firefoxPlist),
      "fetch a Firefox that supports it (FIREFOX_VERSION, e.g. an ESR: see scripts/fetch-firefox.js)",
    ]);
  }

  for (const [what, minimum, fix] of needs) {
    if (minimum == null) {
      console.warn(`  • could not read the minimum macOS of ${what}; not checked`);
    } else if (compareVersions(minimum, claimed) > 0) {
      throw new Error(
        `${what} needs macOS ${minimum}, but this build says it runs on macOS ${claimed} (mac.minimumSystemVersion). ` +
          `Raise minimumSystemVersion, or ${fix}.`
      );
    } else {
      console.log(`  • ${what} runs on macOS ${minimum}+ (build minimum: ${claimed})`);
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === "darwin") {
    checkMacMinimum(context);
    return;
  }
  if (context.electronPlatformName !== "win32") return;
  for (const file of UNUSED_WINDOWS_FILES) {
    const target = path.join(context.appOutDir, file);
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      console.log(`  • removed unused ${file}`);
    }
  }
};
