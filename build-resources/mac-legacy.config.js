// electron-builder config for the legacy Mac build: macOS 10.15 Catalina and
// macOS 11 Big Sur, which the main build (macOS 12+) can't run on.
//
//   npm run dist:mac-legacy
//
// Electron 38 and later need macOS 12, and Electron 33 and later need macOS 11,
// so this build packages Electron 32, the last one that runs on Catalina. It
// gets no more Chromium security fixes, which is acceptable here only because
// the window shows nothing but the app's own page (public/electron.js blocks
// every other URL); Vinted is opened in the bundled Firefox, which is current.
// Everyone else keeps the main build and current Electron.
//
// Intel only: every Mac stuck on macOS 10.15 or 11 is an Intel Mac (Apple
// Silicon shipped with 11 and updates to 12+).
//
// It updates from its own channel (legacy-mac.yml in each release), so it
// never installs the main build on a macOS that can't run it. Once the Mac is
// on macOS 12+, the app moves itself to the main build (src/main/updater.ts).
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
      { target: "dmg", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ],
    minimumSystemVersion: MINIMUM_MACOS,
    artifactName: "Vinbot-Authenticator-${version}-mac-legacy-${arch}.${ext}",
    ...(adHoc ? { identity: "-", hardenedRuntime: false } : {}),
  },
};
