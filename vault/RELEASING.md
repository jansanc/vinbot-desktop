# Releasing

The app ships for Windows (x64) and macOS 10.15+. macOS 13+ gets two builds,
one for Apple Silicon (arm64) and one for Intel (x64): a single universal
build carried both copies of Electron, and was twice the download (408 MB
zipped). macOS 10.15 to 12 get the legacy build, also for both (see below).

## Build

Bump `version` in `package.json` first. It goes into the file names and what
the OS shows as the app version.

**Both platforms (the normal way): GitHub Actions.** A Mac is needed to build
the macOS app, so `.github/workflows/build.yml` builds each platform on its
own runner.

- Actions > **Build installers** > **Run workflow**, then download the
  installers from the run's artifacts, or
- push a tag matching the version (`git tag v1.0.1 && git push origin v1.0.1`)
  to also get a **draft** GitHub Release with everything attached. Check it,
  then publish it.

**Locally:** `npm ci`, then

- `npm run dist:win` on Windows
- `npm run dist:mac` on a Mac
- `npm run dist:mac-legacy` on a Mac, for macOS 10.15 to 12

Each one cleans `dist/`, `build/` and `dist-app/`, compiles the main process,
builds the renderer and packages it into `dist-app/`:

| File | For |
| --- | --- |
| `Vinbot-Authenticator-Setup-<version>.exe` | Windows installer: per-user, no admin needed, lets the user pick the folder, adds Start menu and desktop shortcuts and an uninstaller. Give this one to Windows users. |
| `Vinbot-Authenticator-Portable-<version>.exe` | Windows, runs without installing. |
| `Vinbot-Authenticator-<version>-mac-arm64.dmg` | macOS on Apple Silicon (M1 and later): open it, drag the app to Applications. Give this one to most Mac users. |
| `Vinbot-Authenticator-<version>-mac-x64.dmg` | macOS on Intel Macs. |
| `Vinbot-Authenticator-<version>-mac-<arch>.zip` | macOS, the same apps zipped; also what installed copies update from (each Mac takes its own architecture). |
| `Vinbot-Authenticator-<version>-mac-legacy-<arch>.dmg` | macOS 10.15 Catalina, 11 Big Sur and 12 Monterey, arm64 and x64. Only for Macs that can't run macOS 13. |
| `Vinbot-Authenticator-<version>-mac-legacy-<arch>.zip` | The same, zipped; what installed legacy copies update from. |
| `latest*.yml`, `legacy-mac.yml`, `*.blockmap` | What installed apps read to find and download an update. Always publish them with the installers. |

## Updates

Installed copies update themselves (`src/main/updater.ts`, `electron-updater`)
from the Releases of this repo, `jansanc/vinbot-desktop`. It is public, so the
apps download with no token. If it is ever made private again, updates stop:
move them to a public releases-only repo first (`build.publish` in
`package.json`, and the release job's `repository` and `token`).

The app checks 10 seconds after launch and every 4 hours, downloads a new
version in the background, then shows "Version x is ready" with *Restart to
update*. If the user ignores it, the update installs the next time they quit.
Restarting is refused while a session login or upload is running.

No setup is needed: the release job writes with the workflow's own
`GITHUB_TOKEN`.

**Shipping a version**

1. Bump `version` in `package.json`. Updates only go forward: the new version
   must be higher than what users have.
2. Commit, then `git tag v<version> && git push origin v<version>`.
3. CI builds both platforms and creates a **draft** release in this repo
   with the installers, `latest.yml`, `latest-mac.yml` and the blockmaps.
4. Test the installers, then **publish** the draft. Publishing is the
   rollout: every installed copy picks it up within about 4 hours, or at its
   next launch.

To pull a bad release, delete it (or turn it back into a draft) before more
users get it, then ship a fixed, higher version. Apps never downgrade.

**Limits**

- **Copies installed before 1.1.0 have no updater.** Users of 1.0.0 must
  download and install 1.1.0 (or later) once by hand. From then on it is
  automatic.
- **macOS only updates signed builds.** macOS refuses to swap in an update
  that isn't signed with a Developer ID (see Signing). Ad-hoc signed Mac
  builds keep working, but never update.
- **The Windows portable exe doesn't update.** Only the installer
  (`Setup-<version>.exe`) does.
- **Logs:** each machine keeps `updater.log` in the app's data folder:
  `%APPDATA%\vinbot-desktop-authenticator\logs\` on Windows, and
  `~/Library/Application Support/vinbot-desktop-authenticator/logs/` on
  macOS. Ask for it when a user is stuck on an old version.

The web app's download buttons (`NEXT_PUBLIC_AUTHENTICATOR_WINDOWS_URL` and
`NEXT_PUBLIC_AUTHENTICATOR_MAC_URL` in vinted-api) can point at this repo's
releases, or at R2 (see the deployment runbook).

## Signing

Unsigned builds work, but the OS warns before the first run:

- **Windows** shows "Windows protected your PC". Users click *More info* >
  *Run anyway*.
- **macOS** refuses to open the app at first. Users open *System Settings* >
  *Privacy & Security*, scroll down, click *Open Anyway* for Vinted
  Authenticator, and confirm. Many users won't get past this, so sign and
  notarize before a wide release.

To sign and notarize the macOS app you need an Apple Developer account
($99/year) and a *Developer ID Application* certificate. Add these repository
secrets (Settings > Secrets and variables > Actions); the workflow picks them
up automatically:

| Secret | Value |
| --- | --- |
| `MAC_CERT_P12_BASE64` | The certificate exported from Keychain as .p12, base64-encoded (`base64 -i cert.p12`) |
| `MAC_CERT_PASSWORD` | The .p12's password |
| `APPLE_ID` | The Apple account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password from account.apple.com |
| `APPLE_TEAM_ID` | The 10-character team id |

Without them the workflow builds an ad-hoc signed app with the hardened
runtime off (ad-hoc signing and the hardened runtime together make the app
fail to launch).

## Configuration

Nothing is read from `.env` in an installed app. The API URL falls back to
`https://api.vinbot.app` (`src/config/config.ts`). `REACT_APP_*` values in
`.env` are inlined into the renderer at build time, so check `.env` before a
local build (CI has no `.env` and uses the defaults).

## What ships

Only `public/{electron,preload}.js`, the renderer in `build/` (without source
maps), the compiled main process in `dist/`, the runtime dependencies
(`sql.js`, `electron-updater`), and Firefox (below). Everything the renderer
imports is bundled by Vite, so it lives in `devDependencies`.

The installed app can't be run as anything but itself: Electron fuses
(`build.electronFuses`) switch off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and
`--inspect`, and make it load only its own `app.asar`, checked against a hash
in the executable (a modified archive won't start). `public/electron.js`
refuses `--remote-debugging-port/-pipe` in a packaged build. Debugging an
installed build therefore means building one without these. A new package used by the main process must go in
`dependencies`, or the installed app fails to load it.

## Firefox

The app ships its own Firefox, so users don't need one. `npm run dist:*`
runs `npm run firefox:fetch` (`scripts/fetch-firefox.js`) first: it downloads
Mozilla's latest release for the OS it runs on into `vendor/firefox` (not in
git), checks it against Mozilla's SHA-512 sums, and electron-builder copies it
to `resources/firefox`. Pin a version with `FIREFOX_VERSION=158.0`.

- It never updates itself (on Windows, `distribution/policies.json`; on
  macOS, the login profile's prefs). **Each app release is what updates it**,
  so release regularly, or at least for Firefox security releases.
- About 85 MB of the installer (179 MB instead of 94 MB on Windows). The
  Windows copy drops what a login window never uses (updater, crash
  reporter, WebGPU compiler, local-AI runtime): see `WINDOWS_UNUSED`.
- macOS: `Firefox.app` keeps Mozilla's signature (`mac.signIgnore`), which
  notarization accepts for nested code. Check `spctl -a -vv` on the built app.
- An installed Firefox is only the fallback (a build without `vendor/firefox`,
  or `npm start` before fetching): Program Files and `%LOCALAPPDATA%` on
  Windows; `/Applications`, `~/Applications` or wherever Spotlight finds it
  on macOS.

## Legacy Mac build (macOS 10.15 to 12)

Electron 44+ needs macOS 13 (Chromium 151 dropped Monterey), so the main Mac
build does too. Up to 1.2.6 the app claimed macOS 12, but didn't start there.
The legacy build (`build-resources/mac-legacy.config.js`) is the same app
packaged with Electron 32, the last version that runs on macOS 10.15
Catalina, for Intel and Apple Silicon.

- **Electron 32 gets no more security fixes.** That is acceptable only
  because the window shows nothing but the app's own page; Vinted opens in
  the bundled Firefox, which is the current release (Firefox supports macOS
  10.15+). Don't make the window load remote pages while the legacy build
  exists.
- **Its own update channel.** It is published with `channel: legacy`, so it
  reads `legacy-mac.yml` and never installs the main build on a macOS that
  can't run it. Once the user upgrades to macOS 13+, the app switches itself
  to `latest-mac.yml` and moves to the main build (`src/main/updater.ts`).
- **Same code.** No separate branch: main-process code must keep running on
  Electron 32 (Node 20, Chromium 128). Check with
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm i --no-save --ignore-scripts electron@32.3.3 && npm run typecheck`,
  then `npm ci` to restore.
- **Checked at build time.** On every Mac build, `build-resources/after-pack.js`
  fails the build if Electron or the bundled Firefox needs a newer macOS than
  `mac.minimumSystemVersion`. When Firefox drops Catalina, the legacy build
  will fail there: pin a Firefox ESR that still supports it with
  `FIREFOX_VERSION`, or retire the legacy build.

## Platform notes

- On macOS, closing Firefox's last window doesn't quit it. The login watches
  for the window to close (with `osascript`, which needs no permission) and
  then quits Firefox itself with SIGTERM (SIGKILL 10s later if it's still
  running). Not an Apple event, as ⌘Q sends: that would ask the user for
  Automation permission. Quitting with ⌘Q always works, and the app tells Mac
  users so.
- On macOS the app offers to move itself to Applications when run from
  anywhere else (the mounted DMG, Downloads). Firefox has its own handling for
  running from a disk image, and updates need the app in Applications.

## Smoke test before sending

On a clean machine of each OS (for the legacy build, a Mac on macOS 10.15 to
12), **without Firefox installed**: install, log
in, and run one "Open Firefox and log in" flow end to end. On macOS, check that
closing the Firefox window (not ⌘Q) saves the session, that no "wants to
control Firefox" permission prompt appears, and that opening the app from the
mounted DMG offers to move it to Applications.

## Troubleshooting

- `EPERM: operation not permitted, rename '...win-unpacked.tmp'`: antivirus
  or an editor watcher holding the freshly unpacked Electron. `dist:win`
  avoids that step by packaging the Electron copy in `node_modules`, so use it
  rather than calling `electron-builder` directly.
