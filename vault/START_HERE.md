# 🚀 START HERE - Running the Desktop Authenticator

## The One Command You Need

```bash
npm start
```

That's it! No other commands needed.

---

## What Happens When You Run `npm start`

```
1. TypeScript compiles (5-10 sec)
   └─ Creates: dist/main/ipc-handlers.js

2. React dev server starts (10-15 sec on first run)
   └─ Runs on: http://localhost:3002

3. Electron window launches
   └─ Loads React from port 3002
   └─ Injects preload.js bridge
   └─ Makes electronAPI available

4. DevTools opens automatically
   └─ Shows console, network, etc.

⏱️  Total: 30-45 seconds first time, 10-20 seconds after
```

## Success Looks Like This

You should see in the terminal:
```
[Electron] Starting...
[Electron] App ready!
[IPC] Handlers registered successfully
[Electron] Loading URL: http://localhost:3002
```

And in the Electron window:
- App loads with "Vinbot Authenticator" title
- "Login Form" appears (or extraction form if already logged in)
- Firefox profiles dropdown populates (after login)
- **No errors in DevTools console** ✅

## Common Issues & Fixes

### ❌ "Electron API not available"

**Problem**: You ran `npm run react-start` instead of `npm start`

**Fix**:
```bash
# Stop what you're running (Ctrl+C)
# Run the correct command:
npm start
```

See: [ELECTRON_NOT_LOADING.md](ELECTRON_NOT_LOADING.md)

### ❌ "Cannot find module preload.js"

**Problem**: Preload script not in the right place

**Fix**:
```bash
npm run compile:main
npm start
```

### ❌ Blank Window

**Problem**: React dev server still compiling

**Fix**: Wait 30+ seconds on first run for React to compile
- Watch the terminal for "webpack compiled" message
- Once you see it, the window will load

### ❌ Port 3002 Already in Use

**Problem**: Another process is using port 3002

**Fix**:
```bash
# Kill all Node processes and restart
npm start
```

See: [ELECTRON_NOT_LOADING.md](ELECTRON_NOT_LOADING.md) for detailed fixes

## Before You Start

Make sure you have:

```bash
# Check Node is installed
node --version
# Should show: v14+ or higher

# Check npm is installed  
npm --version
# Should show: v6+ or higher

# Install dependencies (if not already done)
npm install
```

## Folder Setup

```
vinbot-desktop-authenticator/
├─ public/
│  ├─ electron.js          ✅ Main process
│  ├─ preload.js           ✅ IPC bridge
│  └─ index.html
├─ src/
│  ├─ App.tsx              ✅ React app
│  ├─ main/
│  │  └─ ipc-handlers.ts   ✅ IPC logic
│  └─ ...
├─ dist/
│  └─ main/
│     └─ ipc-handlers.js   ✅ Compiled (auto-generated)
└─ package.json
```

## Running with Separate Terminals (Advanced)

If `npm start` doesn't work, try running components separately:

```bash
# Terminal 1: Compile TypeScript (watch mode)
npm run compile:main

# Terminal 2: Watch CSS
npm run css:watch

# Terminal 3: Start React dev server
PORT=3002 npm run react-start

# Terminal 4: Once React starts, launch Electron
ELECTRON_DEV=true npx electron .
```

But **`npm start` is simpler** and does all this automatically.

## Next Steps (After App Loads)

1. ✅ App should load without errors
2. ✅ Log in with your credentials
3. ✅ Select Firefox browser
4. ✅ See Firefox profiles in dropdown
5. ✅ Follow [QUICK_START.md](QUICK_START.md) for usage

## Stopping the App

```bash
# Click the X to close the Electron window
# Press Ctrl+C in the terminal
```

Both close the app and all running processes.

## API Server (Separate Setup)

The desktop app talks to the vinted-api server. In a separate terminal:

```bash
cd ../vinted-api/api
npm run dev
# Should show: Server running on port 3000
```

**Both app and API server should be running** for full functionality.

## Getting Help

- **Electron API not available?** → [ELECTRON_NOT_LOADING.md](ELECTRON_NOT_LOADING.md)
- **How to use the app?** → [QUICK_START.md](QUICK_START.md)
- **Want to test thoroughly?** → [TESTING_GUIDE.md](TESTING_GUIDE.md)
- **Need system architecture?** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **What was implemented?** → [CHANGES.md](CHANGES.md)

## TL;DR

```bash
npm start
# Wait 30-45 seconds
# App opens
# Success! ✨
```

---

**Version**: 1.0.0
**Status**: Ready to run! 🚀

Go ahead and run `npm start`!
