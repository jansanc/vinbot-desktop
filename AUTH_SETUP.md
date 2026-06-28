# Authentication Setup Guide

This guide explains the authentication system integrated into the Vinted Authenticator desktop app.

## Overview

The app now supports user authentication against the vinted-api authentication module. Users must log in before accessing the session extraction features.

### Authentication Flow

1. **Login Screen** — User enters email and password
2. **API Call** — Credentials are sent to vinted-api `/auth/login` endpoint
3. **Session Storage** — Access/refresh tokens are stored in localStorage
4. **Protected Features** — User sees profile info and can access extraction tools
5. **Auto-Logout** — Session expires after the configured token lifetime

## Quick Verification Checklist

Before setting up, verify the vinted-api is working:

```bash
# Terminal 1: Start vinted-api
cd vinted-api
npm install
npm run dev
# Should see: "Server running on http://localhost:3000"

# Terminal 2: Test the login endpoint
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Expected: 401 error (invalid credentials) or 200 (if user exists)
# NOT expected: ECONNREFUSED or "Cannot POST" error
```

✅ If curl works → vinted-api is running correctly  
❌ If ECONNREFUSED → vinted-api is not running on port 3000  
❌ If "Cannot POST /auth/login" → check auth routes are registered

## Setup Instructions

### 1. Environment Configuration

Create a `.env` file in the project root (copy from `.env.example`):

```bash
# .env
REACT_APP_API_URL=http://localhost:3000
```

Replace `http://localhost:3000` with your vinted-api server URL:
- **Development**: `http://localhost:3000` (default)
- **Production**: `https://your-api-domain.com`

**Important**: The default port for vinted-api is **3000**, not 3001.

### 2. Ensure vinted-api is Running

Make sure the vinted-api server is running and the `/auth/login` endpoint is accessible.

**Start vinted-api:**
```bash
cd vinted-api
npm install
npm run dev
```

The API should be available at `http://localhost:3000/auth/login`

### 3. Start the Desktop App

```bash
npm install
npm start
```

This starts the dev server with Electron and React.

### 4. Test Login

1. Open the app — you'll see the login form
2. Enter test credentials (or your Vinted account credentials)
3. Click "Sign In"
4. On success, you'll see your user profile and can access extraction tools

## Project Structure

### New Components

**`src/components/LoginForm.tsx`**
- Email/password input form
- Client-side validation
- Error display and password visibility toggle
- Loading state management

**`src/components/UserProfile.tsx`**
- Displays authenticated user info
- Shows role, subscription tier, AI token budget
- Sign out button

### Services

**`src/services/api.service.ts`**
- HTTP client for vinted-api endpoints
- Methods: `login()`, `refreshToken()`, `getCurrentUser()`, `logout()`
- Error handling and response parsing

**`src/services/auth.service.ts`**
- Authentication business logic
- Session persistence (localStorage)
- Token refresh handling
- Session validation and expiration checks

### Styling

**`src/styles/LoginForm.css`**
- Modern login UI with gradient background
- Form validation and error states
- Loading spinner and hover effects

**`src/styles/UserProfile.css`**
- Profile card with user info
- AI token budget progress bar
- Role badges with color coding
- Responsive design

### Types

**`src/types.ts`**
- `AuthState` — `"unauthenticated" | "authenticating" | "authenticated" | "error"`
- Used in App component to manage auth flow

## API Integration

### Endpoint Verification ✓

All endpoints have been verified against vinted-api specifications:

| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `/auth/login` | POST | ❌ No | Authenticate with email/password |
| `/auth/refresh` | POST | ❌ No | Refresh expired access token |
| `/auth/me` | GET | ✅ Yes (Bearer) | Get current user profile |
| `/auth/logout` | POST | ✅ Yes (Bearer) | Invalidate session |

**Implementation Status**: ✅ All endpoints correctly implemented

**Key Details**:
- Login endpoint accepts: `{ email, password }`
- All authenticated endpoints use `Authorization: Bearer <token>` header
- Session tokens have expiration (`expiresAt` timestamp in seconds)
- Response format matches vinted-api specification

### Login Endpoint

**Request:**
```typescript
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (Success):**
```json
{
  "status": "success",
  "message": "Login successful",
  "data": {
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "premium",
      "aiTokenBudget": {
        "monthly": 10000,
        "used": 2500,
        "remaining": 7500,
        "resetDate": "2026-07-26T00:00:00Z"
      },
      "subscriptionTier": "pro",
      "billingOverdue": false,
      "daysUntilBilling": 25
    },
    "session": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "refresh_token...",
      "expiresIn": 3600,
      "expiresAt": 1687000000
    }
  }
}
```

### Session Management

**Token Storage:**
- Tokens are stored in browser localStorage with keys:
  - `vinted_session` — Session object with tokens and expiration
  - `vinted_user` — User profile data

**Session Validation:**
```typescript
const isValid = AuthService.isSessionValid(); // checks expiration
const session = AuthService.getSession();
const user = AuthService.getUser();
```

**Token Refresh:**
```typescript
const newSession = await AuthService.refreshSession();
```

**Logout:**
```typescript
await AuthService.logout(); // calls API and clears localStorage
```

## Security Considerations

### ✅ Implemented

- Tokens stored in localStorage (accessible to scripts on the domain)
- Session expiration validation
- Refresh token handling
- Logout clears sensitive data
- HTTPS recommended for production
- Password masked by default (Show/Hide toggle)

### ⚠️ To Consider

- **localStorage vs sessionStorage** — Currently uses localStorage (persists across browser closes)
  - Change to `sessionStorage` if you want sessions to clear on app close
  - Update both `api.service.ts` and `auth.service.ts` STORAGE_KEYS

- **XSS Protection** — React automatically escapes content, but sanitize any user input from API

- **CORS** — Ensure vinted-api allows CORS requests from the Electron app
  - Check vinted-api's CORS configuration if you get CORS errors

- **Secure Contexts** — Use HTTPS in production (avoid passing tokens over HTTP)

## Troubleshooting

### Login fails with network error

1. Check `.env` file has correct `REACT_APP_API_URL`
2. Verify vinted-api is running on the configured URL
3. Check browser console (F12) for detailed error message

### "Failed to parse response" error

1. Ensure vinted-api is responding with proper JSON
2. Check API server logs for errors
3. Verify the `/auth/login` endpoint exists and is properly configured

### Session not persisting

1. Check browser's localStorage is enabled
2. Verify `REACT_APP_API_URL` is correct (localStorage is domain-specific)
3. Look in dev tools → Application → Local Storage

### CORS errors in browser console

**IMPORTANT**: Electron apps using `file://` protocol don't have a traditional "origin". If you encounter CORS errors:

1. **For Development**: Electron DevTools will show Origin as `electron://` or similar
   - vinted-api must allow this origin
   - Update vinted-api `.env`:
     ```
     CORS_ORIGINS=http://localhost:3000,electron://app
     ```

2. **For Production Builds**: Check what origin the packaged Electron app uses
   - May be `electron://` or `app://`
   - Add to vinted-api CORS configuration

3. **Temporary Fix (dev only)**: Set CORS to allow all origins
   ```bash
   # In vinted-api .env (NEVER do this in production!)
   CORS_ORIGINS=*
   ```

4. **Proper vinted-api CORS setup**:
   - Edit vinted-api `.env`:
     ```
     CORS_ORIGINS=http://localhost:3000,electron://app
     ```
   - Restart vinted-api server
   - The `credentials: true` flag allows cookies in requests

## Customization

### Change Login UI

Edit `src/components/LoginForm.tsx` to:
- Add "Remember Me" checkbox
- Add "Forgot Password" link
- Change colors/styling

### Add Social Login

Add new auth methods in `api.service.ts`:
```typescript
static async loginWithGoogle(googleToken: string) {
  // Call vinted-api OAuth endpoint
}
```

### Modify User Profile Display

Edit `src/components/UserProfile.tsx` to show/hide specific fields:
- Remove AI token budget bar
- Add custom user metadata
- Add profile picture upload

### Adjust Token Expiration

Edit `src/services/auth.service.ts`:
```typescript
// Add auto-refresh before expiration
const REFRESH_BEFORE_EXPIRY = 5 * 60 * 1000; // 5 minutes
```

## Production Deployment

### Before Deploying

1. ✅ Set `REACT_APP_API_URL` to production API URL in `.env`
2. ✅ Test login flow in staging environment
3. ✅ Verify CORS configuration on API server
4. ✅ Use HTTPS for all API communications
5. ✅ Review security considerations section above

### Build for Distribution

```bash
npm run build              # Build React app
npm run electron-build    # Package as Electron app
```

Output files in `dist-app/`:
- Windows: `.exe` installer and portable version
- macOS: `.dmg` installer
- Linux: AppImage and other formats

## Technical Reference: API Calls

### How the Desktop App Calls vinted-api

**1. Login Flow**
```typescript
// Desktop app calls:
POST http://localhost:3000/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

// Expected response (200 OK):
{
  "status": "success",
  "message": "Login successful",
  "data": {
    "user": { /* user profile */ },
    "session": {
      "accessToken": "eyJ...",
      "refreshToken": "refresh_...",
      "expiresIn": 3600,
      "expiresAt": 1687000000
    }
  }
}
```

**2. Protected Endpoint Example (getCurrentUser)**
```typescript
// Desktop app calls:
GET http://localhost:3000/auth/me
Authorization: Bearer eyJ...

// Expected response (200 OK):
{
  "status": "success",
  "message": "User retrieved successfully",
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    // ... other user fields
  }
}
```

**3. Token Refresh**
```typescript
// Desktop app calls:
POST http://localhost:3000/auth/refresh
Content-Type: application/json

{
  "refreshToken": "refresh_token_string"
}

// Expected response (200 OK):
{
  "status": "success",
  "message": "Session refreshed successfully",
  "data": {
    "session": {
      "accessToken": "new_eyJ...",
      "refreshToken": "new_refresh_...",
      "expiresIn": 3600,
      "expiresAt": 1687003600
    }
  }
}
```

### Implementation Files

**`src/services/api.service.ts`** - HTTP client
- `ApiService.login(credentials)` → POST `/auth/login`
- `ApiService.refreshToken(token)` → POST `/auth/refresh`
- `ApiService.getCurrentUser(token)` → GET `/auth/me`
- `ApiService.logout(token)` → POST `/auth/logout`

**`src/services/auth.service.ts`** - Business logic
- `AuthService.login(email, password)` → calls `ApiService.login()`, stores tokens
- `AuthService.refreshSession()` → handles token refresh automatically
- `AuthService.isSessionValid()` → checks token expiration
- `AuthService.logout()` → clears localStorage and calls API

## Files Created

```
src/
├── services/
│   ├── api.service.ts        # HTTP client for vinted-api
│   └── auth.service.ts       # Auth business logic & session handling
├── components/
│   ├── LoginForm.tsx         # Login form UI
│   └── UserProfile.tsx       # User profile display
├── styles/
│   ├── LoginForm.css         # Login form styles
│   └── UserProfile.css       # Profile styles
└── types.ts                  # (updated) Added AuthState type

.env.example                   # Environment variable template
AUTH_SETUP.md                  # This file
```

## Next Steps

1. Copy `.env.example` to `.env` and configure API URL
2. Start vinted-api server
3. Run `npm start` to launch the app
4. Test login with valid credentials
5. Integration with extraction features now protected by authentication

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review vinted-api documentation
3. Check browser console (F12) for error details
4. Review server logs on vinted-api side
