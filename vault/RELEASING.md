# Releasing

The app ships for Windows (x64) and macOS (one universal build for Intel and
Apple Silicon, macOS 12+).

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

Each one cleans `dist/`, `build/` and `dist-app/`, compiles the main process,
builds the renderer and packages it into `dist-app/`:

| File | For |
| --- | --- |
| `Vinbot-Authenticator-Setup-<version>.exe` | Windows installer: per-user, no admin needed, lets the user pick the folder, adds Start menu and desktop shortcuts and an uninstaller. Give this one to Windows users. |
| `Vinbot-Authenticator-Portable-<version>.exe` | Windows, runs without installing. |
| `Vinbot-Authenticator-<version>-mac.dmg` | macOS: open it, drag the app to Applications. Give this one to Mac users. |
| `Vinbot-Authenticator-<version>-mac.zip` | macOS, the same app zipped. |
| `latest*.yml`, `*.blockmap` | What installed apps read to find and download an update. Always publish them with the installers. |

## Updates

Installed copies update themselves (`src/main/updater.ts`, `electron-updater`)
from the Releases of the **public** repo `jansanc/vinbot-desktop-releases`.
It holds only the installers; the source repo stays private, and the apps
download with no token.

The app checks 10 seconds after launch and every 4 hours, downloads a new
version in the background, then shows "Version x is ready" with *Restart to
update*. If the user ignores it, the update installs the next time they quit.
Restarting is refused while a session login or upload is running.

**One-time setup**

1. Create the public repo `jansanc/vinbot-desktop-releases` (it can be empty).
2. Create a token that can write to it: a fine-grained personal access token
   limited to that repo, with *Contents: Read and write*.
3. Add it to this repo as the `RELEASES_TOKEN` Actions secret.

**Shipping a version**

1. Bump `version` in `package.json`. Updates only go forward: the new version
   must be higher than what users have.
2. Commit, then `git tag v<version> && git push origin v<version>`.
3. CI builds both platforms and creates a **draft** release in
   `vinbot-desktop-releases` with the installers, `latest.yml`,
   `latest-mac.yml` and the blockmaps.
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
`NEXT_PUBLIC_AUTHENTICATOR_MAC_URL` in vinted-api) should point at the public
releases repo as well. The private repo's links fail for anyone not signed in
to GitHub with access to it.

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
maps), the compiled main process in `dist/`, and the two runtime dependencies
(`sql.js`, `tar`). Everything the renderer imports is bundled by webpack, so it
lives in `devDependencies`. A new package used by the main process must go in
`dependencies`, or the installed app fails to load it.

## Platform notes

- Firefox is looked up in Program Files and `%LOCALAPPDATA%` on Windows, and
  in `/Applications`, `~/Applications` or wherever Spotlight finds it on
  macOS. Profiles are read from `%APPDATA%\Mozilla\Firefox` and
  `~/Library/Application Support/Firefox`.
- On macOS, closing Firefox's last window doesn't quit it. The login watches
  for the window to close (with `osascript`) and then quits Firefox itself.
  Quitting with ⌘Q always works, and the app tells Mac users so.

## Smoke test before sending

On a clean machine of each OS: install, log in, import a Firefox session,
and run one "Log in with Firefox" flow end to end. On macOS, check that
closing the Firefox window (not ⌘Q) saves the session.

## Troubleshooting

- `EPERM: operation not permitted, rename '...win-unpacked.tmp'`: antivirus
  or an editor watcher holding the freshly unpacked Electron. `dist:win`
  avoids that step by packaging the Electron copy in `node_modules`, so use it
  rather than calling `electron-builder` directly.
