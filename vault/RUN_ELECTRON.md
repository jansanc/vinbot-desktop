# Running the Desktop Authenticator - Electron Setup Fixed

## Issue Resolved ✅

The error `"Electron API not available"` has been fixed by:
1. Copying `preload.js` to the `public/` directory (Electron needs it there for dev mode)
2. Compiling TypeScript to JavaScript in the `dist/` directory

## How to Run

### Option 1: Using the Dev Script (Recommended)

```bash
cd vinbot-desktop-authenticator
npm run electron-dev
```

This will:
1. Compile TypeScript files
2. Watch CSS files
3. Start React dev server on port 3002
4. Launch Electron app (which loads from localhost:3002)
5. Auto-open DevTools

**Expected Output:**
```
[Electron] Starting...
[Electron] Module loaded successfully
[Electron] Configuration - isDev: true
[Electron] App ready!
[IPC] Handlers registered successfully
[Electron] Creating window...
[Electron] Loading URL: http://localhost:3002
```

### Option 2: Manual Steps

If you prefer to run components separately:

```bash
# Terminal 1: Compile and watch TypeScript
npm run compile:main
# or add auto-compile watcher if available

# Terminal 2: Start the Vite dev server (port 3002, styles included)
npm run renderer:dev

# Terminal 3: Once Vite is up, launch Electron
ELECTRON_DEV=true npx electron .
```

### Option 3: Using the Default Start Script

```bash
npm start
# This runs "npm run electron-dev"
```

## Troubleshooting

### "Electron API not available" Still Appearing?

1. **Check preload.js exists:**
   ```bash
   ls public/preload.js
   # Should show: public/preload.js
   ```

2. **Check IPC handlers compiled:**
   ```bash
   ls dist/main/ipc-handlers.js
   # Should show: dist/main/ipc-handlers.js
   ```

3. **Rebuild everything:**
   ```bash
   npm run compile:main
   npm run renderer:build
   npm start
   ```

### Blank Window?

- Electron is loading React from `http://localhost:3002`
- If React dev server hasn't started, you'll see a blank window
- Wait 10-15 seconds for React to compile on first run
- Check terminal output for compilation errors

### "Failed to load firefox profiles"

Once the Electron API is available:
1. Wait for app to fully load
2. You should see Firefox profiles dropdown populate
3. If not, Firefox may not be installed or profiles don't exist

### DevTools Won't Open?

- DevTools automatically open in dev mode
- If you closed it, press Ctrl+Shift+I to reopen
- Check DevTools Console tab for errors

## Build for Production

When ready to distribute:

```bash
npm run electron-build
# Creates .exe file in dist-app/
```

## Environment Variables

```bash
# Development (auto-set)
ELECTRON_DEV=true      # Enables dev features and DevTools
PORT=3002              # React dev server port

# Production (for testing prod build)
ELECTRON_DEV=false     # Disables dev features
NODE_ENV=production    # Production optimizations
```

## File Structure

```
public/
├── electron.js         # Main Electron process
├── preload.js          # IPC bridge (FIXED ✅)
└── index.html          # React app template

dist/
├── main/
│   └── ipc-handlers.js # Compiled IPC handlers (FIXED ✅)
├── index.html
├── bundle.js
└── ...

src/
├── App.tsx
├── main/
│   ├── ipc-handlers.ts
│   └── extractors/
└── ...
```

## Next Steps

1. ✅ Preload script is in place
2. ✅ IPC handlers are compiled
3. Run `npm start` and launch the app
4. Follow QUICK_START.md for usage instructions

---

**Status**: Electron setup is complete and ready to run! 🚀
