# Architecture Overview - Desktop Session Integration

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Desktop Authenticator (Electron App)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          React UI Layer                            │   │
│  │  ┌──────────────────────────────────────────────────────────────┐ │   │
│  │  │  App.tsx                                                     │ │   │
│  │  │  ├─ State: authState, state, extractionData                 │ │   │
│  │  │  ├─ handleExtraction()                                      │ │   │
│  │  │  │  └─ Passes saveMethod to IPC handler                     │ │   │
│  │  │  └─ Renders ExtractionForm or ProgressDisplay              │ │   │
│  │  └──────────────────────────────────────────────────────────────┘ │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐ │   │
│  │  │  ExtractionForm.tsx                                          │ │   │
│  │  │  ├─ State: saveMethod, selectedBrowser, formData             │ │   │
│  │  │  ├─ Render: Browser selection buttons                        │ │   │
│  │  │  ├─ Render: Save method selection (NEW)                      │ │   │
│  │  │  ├─ Render: Account details form                             │ │   │
│  │  │  │  └─ Conditional user email field (based on saveMethod)   │ │   │
│  │  │  └─ handleSubmit()                                           │ │   │
│  │  │     └─ Validates user email when database save selected      │ │   │
│  │  └──────────────────────────────────────────────────────────────┘ │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Electron Main Process (IPC)                       │   │
│  │  ┌──────────────────────────────────────────────────────────────┐  │   │
│  │  │  ipc-handlers.ts                                             │  │   │
│  │  │  ├─ extract:vinted:session                                   │  │   │
│  │  │  │  └─ Calls firefox.extractor.extractFirefoxProfileData()   │  │   │
│  │  │  ├─ save:extraction                                          │  │   │
│  │  │  │  ├─ if saveMethod includes "file"                        │  │   │
│  │  │  │  │  └─ Call saveToLocalFiles()                           │  │   │
│  │  │  │  ├─ if saveMethod includes "database"                    │  │   │
│  │  │  │  │  └─ Call saveToDatabase()                             │  │   │
│  │  │  │  │     └─ Calls saveFirefoxExtractionData()  ← NEW!       │  │   │
│  │  │  └─ saveToDatabase()                                         │  │   │
│  │  │     └─ Dynamically imports vintedAuth.service                │  │   │
│  │  │        └─ Calls saveFirefoxExtractionData()                  │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        Service Layer                                 │   │
│  │  ┌──────────────────────────────────────────────────────────────┐  │   │
│  │  │  vintedAuth.service.ts (NEW IMPLEMENTATION)                  │  │   │
│  │  │  ├─ saveFirefoxExtractionData()                              │  │   │
│  │  │  │  ├─ Get session from AuthService                          │  │   │
│  │  │  │  ├─ Validate authentication                               │  │   │
│  │  │  │  ├─ Map data to API payload:                              │  │   │
│  │  │  │  │  ├─ fingerprint → browserFingerprint                   │  │   │
│  │  │  │  │  ├─ auth.cookies → sessionData                         │  │   │
│  │  │  │  │  ├─ auth.origins → sessionOrigins                      │  │   │
│  │  │  │  │  ├─ vintedEmail, vintedMemberId                        │  │   │
│  │  │  │  │  └─ updateSessionOnly: false                           │  │   │
│  │  │  │  ├─ Call ApiService.storeDesktopSession()                 │  │   │
│  │  │  │  └─ Return StoreDesktopSessionResult                      │  │   │
│  │  │  └─ Error handling with descriptive messages                 │  │   │
│  │  │                                                                │  │   │
│  │  ├─ auth.service.ts (EXISTING)                                   │  │   │
│  │  │  ├─ AuthService.getSession()  ← Used by saveFirefoxData      │  │   │
│  │  │  └─ AuthService.getUser()                                     │  │   │
│  │  │                                                                │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          API Service                                 │   │
│  │  ┌──────────────────────────────────────────────────────────────┐  │   │
│  │  │  api.service.ts (NEW METHOD)                                 │  │   │
│  │  │  ├─ storeDesktopSession(accessToken, payload)  ← NEW!        │  │   │
│  │  │  │  ├─ POST to /api/v1/vinted/auth/desktop-session           │  │   │
│  │  │  │  ├─ Header: Authorization: Bearer {accessToken}           │  │   │
│  │  │  │  ├─ Body: JSON with fingerprint, cookies, origins         │  │   │
│  │  │  │  └─ Returns: DesktopSessionResponse                       │  │   │
│  │  │  │                                                            │  │   │
│  │  │  ├─ login()           (EXISTING)                              │  │   │
│  │  │  ├─ getCurrentUser()   (EXISTING)                             │  │   │
│  │  │  └─ logout()          (EXISTING)                              │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
                          Network (HTTP/HTTPS)
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Vinted API Server                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  POST /api/v1/vinted/auth/desktop-session                         │   │
│  │  (vintedAuth.routes.ts - VintedAuthController.storeDesktopSession)│   │
│  │                                                                    │   │
│  │  Request:                                                         │   │
│  │  ├─ Authorization: Bearer {token}                                 │   │
│  │  └─ Body: {                                                       │   │
│  │      vintedEmail, browserFingerprint, sessionData,                │   │
│  │      sessionOrigins, vintedMemberId, updateSessionOnly            │   │
│  │    }                                                              │   │
│  │                                                                    │   │
│  │  Middleware Chain:                                                │   │
│  │  ├─ requireHealthySubscription()                                  │   │
│  │  ├─ validate(storeDesktopSessionSchema, "body")                   │   │
│  │  └─ catchAsync(VintedAuthController.storeDesktopSession)         │   │
│  │                                                                    │   │
│  │  Response (201 Created or 200 OK):                                │   │
│  │  └─ {                                                             │   │
│  │      status: "success",                                           │   │
│  │      message: "Desktop session stored successfully",              │   │
│  │      data: {                                                      │   │
│  │        id, userId, vintedEmail, vintedUsername,                  │   │
│  │        createdAt, updatedAt                                       │   │
│  │      },                                                           │   │
│  │      requestId                                                    │   │
│  │    }                                                              │   │
│  │                                                                    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                            ↓                                                │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                   Database (Supabase)                              │   │
│  │                   vinted_accounts table                            │   │
│  │  ├─ id (UUID)                                                     │   │
│  │  ├─ user_id (UUID)                                                │   │
│  │  ├─ vinted_email                                                  │   │
│  │  ├─ vinted_username                                               │   │
│  │  ├─ vinted_member_id                                              │   │
│  │  ├─ browser_fingerprint (JSON)  ← Stores fingerprint             │   │
│  │  ├─ session_data (JSON Array)  ← Stores cookies                  │   │
│  │  ├─ session_origins (JSON Array) ← Stores localStorage/sessionStorage │
│  │  ├─ created_at                                                    │   │
│  │  └─ updated_at                                                    │   │
│  │                                                                    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Transformation

```
Firefox Profile
├─ cookies.sqlite
│  └─ [Cookie Objects]
├─ storage/default/
│  ├─ .../ls/data.sqlite → localStorage
│  └─ .../ss/data.sqlite → sessionStorage
└─ prefs.js → Browser settings

          ↓ Extract (firefox.extractor.ts)

ExtractionData
├─ fingerprint: Fingerprint
│  ├─ browser, userAgent, timezone, locale
│  ├─ screen, hardwareConcurrency, deviceMemory
│  └─ systemInfo
└─ authentication: AuthData
   ├─ cookies: Cookie[]
   └─ origins: StorageOrigin[]
      ├─ origin
      ├─ localStorage?: LocalStorageItem[]
      └─ sessionStorage?: LocalStorageItem[]

          ↓ Map to API Payload (vintedAuth.service.ts)

API Payload
├─ vintedEmail: string
├─ browserFingerprint: Fingerprint (same structure)
├─ sessionData: Cookie[] (from cookies)
├─ sessionOrigins: StorageOrigin[] (from origins)
├─ vintedMemberId?: string
└─ updateSessionOnly: boolean = false

          ↓ HTTP POST (api.service.ts)

Vinted Accounts Table
├─ browser_fingerprint: JSON (full fingerprint object)
├─ session_data: JSON (array of cookie objects)
├─ session_origins: JSON (array of origins with storage)
└─ vinted_member_id: string
```

## State Management Flow

```
App Component State
├─ authState: "authenticated" | "unauthenticated"
├─ user: AuthUser (from localStorage via AuthService)
└─ session: Session (from localStorage via AuthService)
   ├─ accessToken ← Used by saveFirefoxExtractionData()
   ├─ refreshToken
   ├─ expiresIn
   └─ expiresAt

ExtractionForm State
├─ selectedBrowser: "firefox" | "chrome" | "edge"
├─ selectedProfile: string
├─ saveMethod: "file" | "database" | "both" ← NEW!
└─ formData
   ├─ vintedEmail: string
   ├─ userEmail: string ← Only required if saveMethod has "database"
   ├─ vintedMemberId: string
   └─ vintedBaseUrl: string

App Extraction State
├─ state: ExtractionState
├─ extractionData: ExtractionData
└─ error: string
```

## Validation Flow

```
User Input (ExtractionForm)
    ↓
handleSubmit() validates:
├─ ✓ Browser profile selected (if Firefox)
├─ ✓ Vinted Email filled
├─ ✓ Member ID filled
├─ ✓ User Email filled (only if database save) ← NEW!
    ↓ (all valid)
Call onSubmit()
    ↓
IPC Handler:
├─ Extract session data
├─ Call saveExtraction with saveMethod
    ↓ (if saveMethod includes "database")
Vinted Auth Service:
├─ Validate authenticated session exists
├─ Validate payload structure
    ↓ (all valid)
API Service:
├─ Send to vinted-api
    ↓ (if API validation passes)
Database:
└─ Store in vinted_accounts table
    ↓
Success Response to UI
```

## Types and Interfaces

```
┌─ types.ts
├─ ExtractionState = "idle" | "extracting" | "saving" | "complete" | "error"
├─ AuthState = "unauthenticated" | "authenticating" | "authenticated" | "error"
├─ SaveMethod = "file" | "database" | "both"  ← NEW!
├─ Fingerprint (extracted from Firefox)
├─ Cookie (extracted from browser)
├─ LocalStorageItem (key-value pair)
├─ StorageOrigin (origin + localStorage + sessionStorage)
├─ ExtractionData (fingerprint + authentication)
└─ ExtractionProgress

┌─ api.service.ts
├─ LoginResponse
├─ LoginCredentials
├─ DesktopSessionResponse ← NEW!
└─ ApiService (static methods)

┌─ auth.service.ts
├─ Session (accessToken, refreshToken, etc.)
├─ AuthUser
└─ AuthService (static methods)

┌─ vintedAuth.service.ts
├─ AuthData (cookies + origins)
├─ StoreDesktopSessionResult ← NEW!
└─ saveFirefoxExtractionData() ← NEW IMPLEMENTATION!
```

## Error Handling Strategy

```
Try-Catch Levels:

1. UI Level (App.tsx)
   └─ catch extraction errors
      └─ display error message
      └─ set state to "error"

2. Service Level (vintedAuth.service.ts)
   └─ catch authentication errors
   └─ catch API errors
   └─ catch network errors
      └─ throw with descriptive message

3. API Level (api.service.ts)
   └─ catch fetch errors
   └─ parse error response
      └─ throw with API message or generic error

4. IPC Level (ipc-handlers.ts)
   └─ catch saveToDatabase errors
   └─ log error message
      └─ continue with file save if not required
```

## Security Architecture

```
Authentication Flow:
1. User logs in
   └─ Credentials sent to /api/v1/auth/login
   └─ Receives accessToken + refreshToken
   └─ Stored in localStorage (AuthService)

2. Desktop session stored
   └─ accessToken retrieved from localStorage
   └─ Passed to storeDesktopSession()
   └─ Used in Authorization header: "Bearer {token}"

3. API validates token
   └─ Validates signature and expiration
   └─ Returns 401 if invalid
   └─ Error caught and displayed to user

Security Features:
├─ Bearer token authentication
├─ No credentials stored (only session tokens)
├─ No sensitive data in logs
├─ HTTPS-ready (uses fetch)
├─ Requires healthy subscription (API middleware)
└─ Request validation (Zod schemas)
```

---

## Component Relationship Diagram

```
┌─────────────────────────────────────────────┐
│         App.tsx                             │
│  ├─ manages overall state                   │
│  └─ delegates to child components           │
└─────────────┬───────────────────────────────┘
              │
              ├─ LoginForm ─→ AuthService.login()
              │
              └─ ExtractionForm ─→ Sends to App.handleExtraction()
                                      │
                                      ├─ IPC: extract:vinted:session
                                      │  └─ firefox.extractor
                                      │
                                      └─ IPC: save:extraction
                                         ├─ saveToLocalFiles()
                                         └─ saveToDatabase()
                                            └─ saveFirefoxExtractionData()
                                               ├─ AuthService.getSession()
                                               └─ ApiService.storeDesktopSession()
                                                  └─ HTTP POST to vinted-api
```

---

**Key Innovation**: The implementation separates concerns into layers (UI → Service → API) while maintaining type safety throughout the entire pipeline.
