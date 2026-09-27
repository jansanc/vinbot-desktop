# Storage State Usage Guide

This guide shows how to use Playwright's `storageState` instead of backing up huge browser profiles.

## Problem Solved

- **Before**: Back up full 434MB browser profile → compress → upload
- **After**: Export 5-10KB storageState JSON (cookies + localStorage) → upload

**Benefits**:
- 1000x smaller
- Milliseconds to extract instead of minutes to compress
- Preserves JWT refresh tokens and DataDome cookies
- Read → use → write-back keeps auth fresh

## Basic Usage

### 1. Capture Storage State After Login

```typescript
import { StorageStateManager } from "./services/storage-state-manager";

// After successful Vinted login in Playwright
const manager = new StorageStateManager(
  "/path/to/app/data",
  vintedAccountId,
  "chrome", // browser type
  "Default" // profile id
);

// This captures cookies + localStorage + context config
const state = await manager.saveStorageState(context, {
  userAgent: context.browser().version(),
  locale: "es-ES",
  timezoneId: "Europe/Madrid",
  viewport: { width: 1280, height: 800 },
});

// Get summary for logging
const summary = await manager.getSummary();
console.log(`Saved storage state: ${summary.sizeKB}KB`);
// Output: Saved storage state: 8.3KB
```

### 2. Load Storage State and Rehydrate Context

```typescript
const manager = new StorageStateManager(
  "/path/to/app/data",
  vintedAccountId,
  "chrome",
  "Default"
);

// Load previous session
const previousState = await manager.loadStorageState();

// Launch context with that state (cookies + localStorage)
// IMPORTANT: Use the SAME context params as when state was captured
const context = await browser.newContext({
  storageState: previousState, // Hydrate cookies + localStorage
  userAgent: previousState.contextConfig.userAgent,
  locale: previousState.contextConfig.locale,
  timezoneId: previousState.contextConfig.timezoneId,
  viewport: previousState.contextConfig.viewport,
});

// Now the context has the same auth state + DataDome cookie
// as when we saved it. Requests to Vinted will work immediately.
```

### 3. Read → Use → Write-Back Loop (Recommended)

This pattern keeps tokens fresh by writing back after each job:

```typescript
const { result, state } = await manager.withStorageState(
  context,
  {
    userAgent: "...",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1280, height: 800 },
  },
  async (previousState) => {
    // Job executes with either:
    // - previousState (if one exists from earlier run)
    // - null (first time)

    if (!previousState) {
      console.log("First run - need to log in to Vinted");
      // Your login logic here
    } else {
      console.log("Reusing previous session");
      // Context already has auth from previousState
    }

    // Do your work here (list products, send offers, etc.)
    // The context is automatically hydrated with cookies
    const products = await page.goto("https://www.vinted.es/...");

    return products;
  }
);

// Fresh state is automatically saved at the end
// Next run will load this fresh state
console.log(`Job result: ${result}`);
console.log(`Fresh state saved: ${(state.cookies.length)} cookies`);
```

## What Gets Captured

```typescript
interface StorageState {
  cookies: [
    {
      name: "access_token_web",
      value: "eyJhbGc...", // Fresh JWT from last run
      domain: ".vinted.es",
      httpOnly: true,
      secure: true,
    },
    {
      name: "refresh_token_web",
      value: "...",
      domain: ".vinted.es",
      httpOnly: true,
    },
    {
      name: "_dd",
      value: "...", // DataDome cookie (bound to UA + IP)
      domain: ".vinted.es",
    },
    // ... other cookies
  ],
  origins: [
    {
      origin: "https://www.vinted.es",
      localStorage: [
        { name: "vinted_user", value: "..." },
        // ... per-origin localStorage
      ],
    },
  ],
  contextConfig: {
    userAgent: "Mozilla/5.0 ...",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1280, height: 800 },
    capturedAt: 1718256000000,
  },
}
```

## Critical: DataDome Consistency

DataDome binds the cookie to:
- User-Agent
- Browser fingerprint
- IP address behavior

**If you change any of these, DataDome will challenge you:**

```typescript
// ❌ WRONG - Different UA than when state was captured
const context = await browser.newContext({
  storageState: state,
  userAgent: "Different UA", // DataDome mismatch!
  locale: state.contextConfig.locale,
  // ...
});

// ✅ RIGHT - Exact match
const context = await browser.newContext({
  storageState: state,
  userAgent: state.contextConfig.userAgent,
  locale: state.contextConfig.locale,
  timezoneId: state.contextConfig.timezoneId,
  viewport: state.contextConfig.viewport,
});
```

Also:
- Use the same egress IP per account (or DataDome sees IP hopping)
- Don't share state between accounts/users
- Rotate state occasionally (run the job regularly to refresh tokens)

## What Doesn't Get Captured

These aren't included in `storageState()` (but not auth-critical for Vinted):
- IndexedDB
- Service Worker caches
- Local cache/temp data
- Browser history

If you need these later, Playwright 1.40+ has an `indexedDB` option for `storageState()`, but Vinted's auth doesn't depend on it.

## Storage Location

States are stored in:
```
~/.app-data/storage-states/{vintedAccountId}/{browser}/{profileId}.json
```

Example:
```
~/.app-data/storage-states/acc_123456/chrome/Default.json
```

## Summary Endpoint

Get size and age of saved state:

```typescript
const summary = await manager.getSummary();
// {
//   exists: true,
//   size: 8543,
//   sizeKB: "8.3",
//   cookieCount: 12,
//   origins: 2,
//   criticalCookies: ["access_token_web", "refresh_token_web", "_dd"],
//   capturedAt: 1718256000000,
//   age: "23 minutes ago",
// }
```

## Comparison: Full Profile vs Storage State

| Metric | Full Profile | Storage State |
|--------|--------------|---------------|
| Size | 434 MB | 8-10 KB |
| Extract time | 176 seconds | <100ms |
| Cookies captured | ✅ Yes | ✅ Yes |
| localStorage captured | ✅ Yes | ✅ Yes |
| IndexedDB captured | ✅ Yes | ❌ No (not needed) |
| Service Worker cache | ✅ Yes | ❌ No (not needed) |
| History preserved | ✅ Yes | ❌ No (not needed) |
| DataDome cookie | ✅ Yes | ✅ Yes |
| JWT refresh tokens | ✅ Yes | ✅ Yes |
| Auth works | ✅ Yes | ✅ Yes |

## Next Steps

1. Replace profile backup extraction with `StorageStateService.captureStorageState()`
2. Use `StorageStateManager.withStorageState()` pattern in your jobs
3. Verify auth tokens refresh correctly after save-back
4. Add encryption at rest (optional but recommended for cookie data)
