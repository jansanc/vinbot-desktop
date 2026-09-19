# Fixing "Electron API not available" Error

## The Problem

You're seeing "Electron API not available" when loading the app. This means **React is running in a web browser** instead of inside the Electron desktop app wrapper.

```
❌ WRONG: React running directly in browser
   localhost:3002 → Browser → No Electron API available

✅ RIGHT: React running inside Electron
   Electron App → Preload.js → React → electronAPI available
```

## The Solution

### Stop What You're Doing

If you're running:
```bash
npm run react-start        # ❌ WRONG - Browser only
PORT=3002 npm run react-start  # ❌ WRONG - Browser only
npm run start              # ✅ CORRECT if run from repo root
```

### Run the Correct Command

```bash
cd vinbot-desktop-authenticator
npm start
```

That's it! This runs the `electron-dev` script which:
1. ✅ Compiles TypeScript
2. ✅ Starts React dev server (port 3002)
3. ✅ Launches Electron app (loads React from port 3002)
4. ✅ Injects preload.js bridge
5. ✅ Makes electronAPI available to React

## Step-by-Step Fix

### 1. Stop All Running Processes

```bash
# Close all terminals running the app
# Close any browser windows with localhost:3002
# Close any Electron windows
```

### 2. Verify Setup is Complete

```bash
# Check preload.js exists
ls public/preload.js
# Should output: public/preload.js

# Check IPC handlers compiled
ls dist/main/ipc-handlers.js
# Should output: dist/main/ipc-handlers.js

# If either is missing, run:
npm run compile:main
```

### 3. Start the App Correctly

```bash
cd vinbot-desktop-authenticator
npm start
```

### 4. Wait for Everything to Load

The app will:
1. Compile TypeScript (5-10 seconds)
2. Start React dev server (10-15 seconds on first run)
3. Launch Electron window
4. Auto-open DevTools

**Total startup time: 30-45 seconds on first run**

### 5. Verify It's Working

You should see in the DevTools console:
```
✅ [Electron] Starting...
✅ [Electron] Module loaded successfully
✅ [Electron] App ready!
✅ [IPC] Handlers registered successfully
✅ [Electron] Creating window...
✅ [Electron] Loading URL: http://localhost:3002
```

Then the app should load normally with the Firefox profiles dropdown working.

## Understanding the Architecture

```
Project Root
│
├─ npm start (main command)
│  ├─ Compiles: TypeScript → dist/
│  ├─ Watches: CSS files
│  ├─ Starts: React dev server (port 3002)
│  └─ Starts: Electron app
│     ├─ Loads: public/electron.js (main process)
│     ├─ Loads: http://localhost:3002 (React UI)
│     ├─ Injects: public/preload.js (IPC bridge)
│     └─ Makes available: window.electronAPI
│
└─ window.electronAPI
   ├─ extractVintedSession()
   ├─ saveExtraction()
   ├─ getFirefoxProfiles() ← Used by App.tsx
   ├─ getChromeProfiles()
   ├─ getEdgeProfiles()
   └─ ... (other IPC methods)
```

## Troubleshooting

### "npm start" Hangs on First Run

This is normal! React has to compile the first time (~15 seconds).
- Give it 1-2 minutes on slow machines
- Check the terminal for "webpack compiled" message
- Once compiled, subsequent runs are faster

### Still Getting "Electron API not available"?

1. **Close ALL browser windows** - React might still be open in browser
2. **Kill all Node processes**:
   ```bash
   # Windows (PowerShell as Admin)
   Get-Process node | Stop-Process -Force
   
   # Mac/Linux
   pkill -f node
   ```
3. **Restart from scratch**:
   ```bash
   cd vinbot-desktop-authenticator
   npm run compile:main
   npm start
   ```

### Electron Window Shows Blank Page

- Wait 30+ seconds on first run (React is compiling)
- Check terminal for React compilation messages
- If still blank after 2 minutes:
  ```bash
  # Kill all processes
  pkill -f node
  pkill -f electron
  
  # Start fresh
  npm start
  ```

### "Cannot find module" Errors

Missing dependencies. Fix with:
```bash
npm install
npm run compile:main
npm start
```

### Port 3002 Already in Use

Another process is using port 3002:
```bash
# Windows (PowerShell)
Get-Process | Where-Object {$_.ProcessName -match "node"} | Stop-Process -Force

# Mac/Linux
lsof -ti:3002 | xargs kill -9

# Then restart
npm start
```

## Quick Checklist

Before running the app, verify:

- [ ] Node.js is installed: `node --version`
- [ ] npm is installed: `npm --version`
- [ ] Dependencies installed: `ls node_modules` (should have folders)
- [ ] Preload script exists: `ls public/preload.js`
- [ ] Electron is installed: `ls node_modules/electron`
- [ ] You're in the right directory: `pwd` shows `.../vinbot-desktop-authenticator`

If anything is missing, run:
```bash
npm install
npm run compile:main
npm start
```

## Environment Variables

Make sure you have:

**Desktop Authenticator (.env)**
```
REACT_APP_API_URL=http://localhost:3000
```

**Vinted API running** (separate terminal)
```bash
cd vinted-api/api
npm run dev
# Should output: Server running on port 3000
```

## Still Not Working?

### Nuclear Option (Complete Reset)

```bash
cd vinbot-desktop-authenticator

# Clean everything
rm -rf node_modules dist build dist-app
npm install

# Rebuild
npm run compile:main
npm run css:build

# Start
npm start
```

### Check System

```bash
# Verify Node version (should be 14+)
node --version

# Verify npm version (should be 6+)
npm --version

# Check if Electron can be found
npx electron --version

# Check if TypeScript compiler works
npx tsc --version
```

## Key Takeaway

| Command | What it does | Use case |
|---------|-------------|----------|
| `npm start` | Full Electron app ✅ | **Always use this** |
| `npm run electron-dev` | Same as `npm start` ✅ | Alternative |
| `npm run react-start` | React browser only ❌ | Don't use for this app |
| `npm run build` | Production build | For deployment |

**TL;DR: Use `npm start`, not `npm run react-start`**

---

**Status**: Once you run `npm start`, the Electron API will be available! 🚀
