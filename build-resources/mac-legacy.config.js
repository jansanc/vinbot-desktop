// electron-builder config for the legacy Mac build: macOS 10.15 Catalina,
// 11 Big Sur and 12 Monterey, which the main build (macOS 13+) can't run on.
//
//   npm run dist:mac-legacy
//
// Electron 44 and later need macOS 13, Electron 38 and later macOS 12, and
// Electron 33 and later macOS 11, so this build packages Electron 32, the
// last one that runs on Catalina. It
// gets no more Chromium security fixes, which is acceptable here only because
// the window shows nothing but the app's own page (public/electron.js blocks
// every other URL); Vinted is opened in the bundled Firefox, which is current.
// Everyone else keeps the main build and current Electron.
//
// Intel and Apple Silicon: Macs on 10.15 and 11 are mostly Intel, but early
// Apple Silicon Macs can still be on 11 or 12.
//
// It updates from its own channel (legacy-mac.yml in each release), so it
// never installs the main build on a macOS that can't run it. Once the Mac is
// on macOS 13+, the app moves itself to the main build (src/main/updater.ts).
//
// The rest of the config is package.json's "build", unchanged.
const { build } = require("../package.json");

const ELECTRON_VERSION = "32.3.3";
const MINIMUM_MACOS = "10.15";

// Same switch as the workflow's unsigned macOS build (-c.mac.identity=-
// -c.mac.hardenedRuntime=false), which can't be passed on the command line
// next to a config file
const adHoc = process.env.MAC_ADHOC_SIGN === "true";

module.exports = {
  ...build,
  electronVersion: ELECTRON_VERSION,
  publish: build.publish.map((target) => ({ ...target, channel: "legacy" })),
  mac: {
    ...build.mac,
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
    minimumSystemVersion: MINIMUM_MACOS,
    artifactName: "Vinbot-Authenticator-${version}-mac-legacy-${arch}.${ext}",
    ...(adHoc ? { identity: "-", hardenedRuntime: false } : {}),
  },
};
