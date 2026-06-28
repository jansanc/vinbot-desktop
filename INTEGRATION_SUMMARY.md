# Desktop Session Integration Summary

## Overview

Implemented integration between `@vinbot-desktop-authenticator` and `@vinted-api` to store Vinted session data extracted from desktop browsers using the `/vinted/auth/desktop-session` API endpoint.

## Architecture

### Data Flow

```
Firefox Browser Profile
    ↓
Extract Session Data (firefox.extractor.ts)
    ↓
ExtractionForm (UI) - User selects save method
    ↓
App.tsx (handleExtraction)
    ↓
IPC Handler (ipc-handlers.ts)
    ↓
saveFirefoxExtractionData (vintedAuth.service.ts)
    ↓
ApiService.storeDesktopSession
    ↓
HTTP POST to vinted-api /vinted/auth/desktop-session
    ↓
Vinted Accounts Database
```

## Components Modified

### 1. **API Service** (`src/services/api.service.ts`)

Added new method for storing desktop session data:

```typescript
static async storeDesktopSession(
  accessToken: string,
  payload: {
    vintedEmail: string;
    browserFingerprint: Record<string, any>;
    sessionData: Array<Record<string, any>>;
    sessionOrigins: Array<Record<string, any>>;
    vintedMemberId?: string;
    updateSessionOnly?: boolean;
  }
): Promise<DesktopSessionResponse>
```

**Features:**
- Authenticates using bearer token
- Makes POST request to `http://localhost:3001/api/v1/vinted/auth/desktop-session`
- Includes proper error handling with user-friendly messages
- Returns typed response matching API contract

### 2. **Vinted Auth Service** (`src/modules/vinted/auth/vintedAuth.service.ts`)

Implemented `saveFirefoxExtractionData()` function:

```typescript
export async function saveFirefoxExtractionData(
  vintedEmail: string,
  fingerprint: Fingerprint,
  auth: AuthData,
  userEmail: string,
  vintedMemberId?: string
): Promise<StoreDesktopSessionResult>
```

**Features:**
- Retrieves authenticated session from AuthService
- Maps extracted fingerprint and auth data to API payload
- Handles authentication and network errors gracefully
- Returns structured response with account details
- Logs operation details for debugging

**Data Mapping:**
- `fingerprint` → `browserFingerprint`
- `auth.cookies` → `sessionData`
- `auth.origins` → `sessionOrigins`
- `vintedEmail`, `vintedMemberId` → passed as-is
- `updateSessionOnly` defaults to `false`

### 3. **Extraction Form UI** (`src/components/ExtractionForm.tsx`)

Enhanced with save method selection:

**Save Methods:**
- **File**: Save fingerprint and auth data to local JSON files
- **Database**: Upload session data to vinted-api server
- **Both**: Save locally AND upload to server

**UI Changes:**
- Added 3-option button group for save method selection
- Conditional rendering of "User Email" field (required for database/both options)
- Updated form validation to require user email when database save is enabled
- Added descriptive labels for each save method

### 4. **App Component** (`src/App.tsx`)

Updated to support variable save methods:

- Changed `saveMethod` from hardcoded `"file"` to user-selected value
- Pass `formData.saveMethod` to IPC handler
- Updated type definitions for form data

### 5. **Types Definition** (`src/types.ts`)

Added `SaveMethod` type:

```typescript
export type SaveMethod = "file" | "database" | "both";
```

## API Contract

### Request
```
POST /api/v1/vinted/auth/desktop-session
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "vintedEmail": "user@vinted.es",
  "browserFingerprint": {
    "extractedAt": "2026-06-28T10:30:00.000Z",
    "browser": "Firefox",
    "userAgent": "Mozilla/5.0 ...",
    "language": "es-ES",
    "timezone": "Europe/Madrid",
    "screen": { "width": 1920, "height": 1080, "colorDepth": 24 },
    "hardwareConcurrency": 8,
    ...
  },
  "sessionData": [
    {
      "name": "_vinted_fr_session",
      "value": "abc123xyz789",
      "domain": ".vinted.es",
      "path": "/",
      "expires": 1719571800,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    },
    ...
  ],
  "sessionOrigins": [
    {
      "origin": "https://www.vinted.es",
      "localStorage": [
        { "name": "session_token", "value": "token_xyz" }
      ],
      "sessionStorage": [
        { "name": "temp_data", "value": "data_value" }
      ]
    },
    ...
  ],
  "vintedMemberId": "12345678",
  "updateSessionOnly": false
}
```

### Response
```
{
  "status": "success",
  "message": "Desktop session stored successfully",
  "data": {
    "id": "uuid-of-linked-account",
    "userId": "uuid-of-user",
    "vintedEmail": "user@vinted.es",
    "vintedUsername": "username",
    "createdAt": "2026-06-28T10:30:00.000Z",
    "updatedAt": "2026-06-28T10:30:00.000Z"
  },
  "requestId": "uuid-for-tracking"
}
```

## Error Handling

1. **Missing Authentication**: Throws error if no session token available
2. **API Errors**: Catches and re-throws with descriptive messages
3. **Network Errors**: Caught by try-catch and returned as string
4. **Validation Errors**: Form validation prevents submission with missing required fields

## User Experience

### Flow for "Both" Save Method

1. User logs in with credentials
2. Selects Firefox browser and profile
3. Selects "Both" as save method
4. Enters Vinted email and personal account email
5. Clicks "Extract & Secure"
6. System extracts session data
7. Saves fingerprint.json and auth-vinted.json locally
8. Uploads data to vinted-api
9. Displays success with account details

### Validation

- Firefox profile required when Firefox selected
- Vinted email always required
- Member ID always required
- User email required only when database save is selected
- Form shows appropriate error messages for missing fields

## CLI Integration

The existing CLI script (`cli/vinted-firefox.ts`) already uses `saveFirefoxExtractionData()` and will now:

```bash
# Interactive mode with database save
npm run extract:vinted:firefox

# Non-interactive with environment variables
VINTED_EXTRACT_EMAIL=user@vinted.es \
VINTED_USER_EMAIL=account@email.com \
VINTED_MEMBER_ID=12345 \
npm run extract:vinted:firefox
```

## Environment Configuration

Required environment variables in `.env`:

```
REACT_APP_API_URL=http://localhost:3001
```

The vinted-api should be running and accessible at the configured URL.

## Testing Checklist

- [ ] User can select different save methods
- [ ] File save creates JSON files locally
- [ ] Database save requires user email
- [ ] API call succeeds when authenticated
- [ ] Error messages display correctly
- [ ] Session token is properly used for authentication
- [ ] Fingerprint data maps correctly to API payload
- [ ] Cookies array maps to sessionData
- [ ] Origins map to sessionOrigins
- [ ] Both save method works for file + database
- [ ] CLI integration still works

## Future Enhancements

1. Add loading state during API upload
2. Display progress bar for large session data
3. Add retry logic for failed uploads
4. Support for Chrome/Edge profile extraction
5. Batch operations for multiple accounts
6. Webhook notifications on successful storage
