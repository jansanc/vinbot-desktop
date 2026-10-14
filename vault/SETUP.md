# Vinbot Authenticator - Setup Guide

## Overview
You now have a complete Electron + React application that extracts Vinted session data from Firefox and saves it locally or to a database.

## Project Structure

```
src/
├── main.ts                          # Electron main process (TypeScript)
├── main/
│   ├── ipc-handlers.ts             # IPC handler definitions
│   └── extractors/
│       └── firefox.extractor.ts    # Firefox data extraction logic
├── modules/
│   └── vinted/auth/
│       └── vintedAuth.service.ts   # Optional database integration (stub)
├── components/                      # React components
│   ├── ExtractionForm.tsx
│   ├── ProgressDisplay.tsx
│   └── ResultsDisplay.tsx
├── App.tsx                          # Main React component
├── types.ts                         # TypeScript type definitions
└── types/
    └── electron.d.ts               # Electron API type definitions

public/
├── electron.js                      # Old main process (can be removed)
├── preload.js                       # IPC bridge for renderer process
└── index.html

dist/                                # Compiled TypeScript (auto-generated)
```

## How It Works

### 1. **Data Extraction Flow**
```
User fills form → Extract Firefox profile → Extract cookies/storage → Display results → Save data
```

### 2. **Data Saving Options**
- **Local File**: Saves JSON files to `%APPDATA%/vinted-auth/` (Windows) or equivalent
- **Database**: Attempts to save to Supabase (requires implementation)
- **Both**: Saves to both locations

### 3. **Key Files**

#### `src/main.ts`
- Initializes the Electron application
- Registers all IPC handlers
- Creates the browser window

#### `src/main/ipc-handlers.ts`
- Handles all communication between React and Node.js
- Provides functions for:
  - `firefox:getProfiles` - List available Firefox profiles
  - `extract:vinted:session` - Extract session data
  - `save:extraction` - Save extracted data

#### `src/main/extractors/firefox.extractor.ts`
- Extracts browser fingerprint (platform, timezone, locale, hardware)
- Reads Firefox cookies from `cookies.sqlite`
- Extracts localStorage and sessionStorage from SQLite databases
- Filters for Vinted-related data only

## Running the Application

### Development
```bash
npm install --legacy-peer-deps
npm start
```

This will:
1. Compile TypeScript to `dist/`
2. Start React dev server on `http://localhost:3000`
3. Launch Electron app pointing to the dev server

### Production Build
```bash
npm run electron-build
```

Creates an installer/portable executable in `dist-app/`

## Features Implemented

✅ **Firefox Profile Detection** - Auto-discovers Firefox profiles
✅ **Browser Fingerprint Extraction** - Captures system info, locale, timezone
✅ **Cookie Extraction** - Reads Vinted-related cookies from Firefox database
✅ **Storage Extraction** - Gets localStorage and sessionStorage data
✅ **Local File Save** - Saves as JSON to user's app data directory
✅ **Form Validation** - Validates email and member ID inputs
✅ **Progress Display** - Shows extraction progress with visual feedback
✅ **Results Display** - Shows extracted data in organized panels
✅ **Data Download** - Users can download fingerprint and auth data as JSON

## What Needs Implementation

### 1. **Supabase Database Integration** (Optional)
Edit `src/modules/vinted/auth/vintedAuth.service.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

export async function saveFirefoxExtractionData(
  vintedEmail: string,
  fingerprint: Fingerprint,
  auth: AuthData,
  userEmail: string,
  vintedMemberId: string,
): Promise<void> {
  const supabase = createClient(url, key);
  // Save to vinted_accounts table
  // ...
}
```

### 2. **Environment Variables**
Create a `.env` file:
```
VINTED_BASE_URL=https://www.vinted.com
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

### 3. **Error Handling Enhancements**
- Add retry logic for failed extractions
- Better error messages for specific failures
- Logging to file for debugging

## Testing

### Manual Testing Checklist
- [ ] Open app, Firefox profiles appear in dropdown
- [ ] Select profile and fill out form
- [ ] Click "Start Extraction"
- [ ] Progress shows stages (fingerprint, cookies, storage)
- [ ] Results display shows summary
- [ ] Download buttons work for JSON files
- [ ] Files are saved to app data directory
- [ ] "New Extraction" button resets form

### Expected Output Files
When saving locally, you'll get:
```
C:\Users\<username>\AppData\Roaming\Vinbot Authenticator\vinted-auth\
├── fingerprint.json      # Browser fingerprint data
└── auth-vinted.json      # Session cookies and storage
```

## Build Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run dev server + Electron |
| `npm run electron-dev` | Compile TypeScript + run dev |
| `npm run electron-build` | Build production app |
| `npm run compile:main` | Just compile TypeScript |
| `npm run renderer:build` | Just build the window (Vite) |
| `npm run typecheck` | Typecheck the app and the CLI |
| `npm test` | Run the tests (Vitest) |
| `npm run extract:vinted:firefox` | Run CLI extractor |

## Dependencies

### Main
- `react` - UI framework
- `dotenv` - Environment variable loading
- `sql.js` - SQLite reading in-memory

### Dev
- `electron` - Desktop framework
- `electron-builder` - Packaging
- `typescript` - Type safety
- `vite` - Window dev server and build
- `vitest` - Tests

## Security Considerations

⚠️ **Important**: This app handles sensitive authentication data:
- Cookies contain session tokens
- Storage may contain auth tokens
- Keep extracted data secure
- Don't share with untrusted parties
- Local files are not encrypted (consider adding encryption)

## Troubleshooting

### "Electron API not available"
- Make sure preload.js is accessible in dev and prod
- Check that context isolation is enabled

### "Firefox profiles not found"
- Ensure Firefox is installed
- Check that APPDATA environment variable is set correctly
- Try setting `FIREFOX_PROFILE` env variable

### TypeScript compilation errors
- Run `npm install --legacy-peer-deps` to fix version conflicts
- Run `npm run compile:main` to check for errors

## Next Steps

1. **Test the basic extraction** with your Firefox profile
2. **Implement Supabase integration** if needed (see above)
3. **Add error logging** for production debugging
4. **Consider adding encryption** for local storage
5. **Set up CI/CD** for automated builds
