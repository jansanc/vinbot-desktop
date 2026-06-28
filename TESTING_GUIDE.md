# Testing Guide - Desktop Session Integration

## Prerequisites

1. **Vinted API Server Running**
   ```bash
   cd vinted-api/api
   npm run dev
   # Server should be running on http://localhost:3000
   ```

2. **Desktop Authenticator Ready**
   ```bash
   cd vinbot-desktop-authenticator
   npm install
   npm run dev
   # App should open in Electron window
   ```

3. **User Account**
   - Must have valid login credentials for the SaaS platform
   - Account must have active subscription for the `/vinted/auth/desktop-session` endpoint to work

## Test Scenarios

### Scenario 1: File Save Only

**Objective**: Verify local file saving works

1. Open Desktop Authenticator
2. Log in with valid credentials
3. Select Firefox browser
4. Select Firefox profile
5. Select **"Local File"** save method
6. Enter:
   - Vinted Email: `test@vinted.es`
   - Member ID: `12345`
7. Click "Extract & Secure"
8. **Verify**:
   - ✓ No errors during extraction
   - ✓ Files created in `src/modules/vinted/auth/`:
     - `fingerprint.json` (contains browser fingerprint)
     - `auth-vinted.json` (contains cookies and storage origins)

### Scenario 2: Database Save Only

**Objective**: Verify API integration works

1. Open Desktop Authenticator
2. Log in with valid credentials
3. Select Firefox browser
4. Select Firefox profile
5. Select **"API Database"** save method
6. Enter:
   - Vinted Email: `test@vinted.es`
   - **Your Account Email**: `user@company.com` (your SaaS account email)
   - Member ID: `12345`
7. Click "Extract & Secure"
8. **Verify**:
   - ✓ No errors during extraction
   - ✓ Success message displays
   - ✓ Check vinted-api logs for successful API call:
     ```
     POST /api/v1/vinted/auth/desktop-session
     Status: 201 or 200
     ```
   - ✓ Verify in database (Supabase) that vinted_accounts table has new entry with:
     - `vinted_email` = `test@vinted.es`
     - `browser_fingerprint` = fingerprint data
     - `session_data` = cookies array
     - `session_origins` = origins array
     - `vinted_member_id` = `12345`

### Scenario 3: Both Save Methods

**Objective**: Verify simultaneous file and database save

1. Open Desktop Authenticator
2. Log in with valid credentials
3. Select Firefox browser
4. Select Firefox profile
5. Select **"Both"** save method
6. Enter:
   - Vinted Email: `test@vinted.es`
   - **Your Account Email**: `user@company.com`
   - Member ID: `12345`
7. Click "Extract & Secure"
8. **Verify**:
   - ✓ No errors during extraction
   - ✓ Success message displays
   - ✓ Local files created (same as Scenario 1)
   - ✓ Database entry created (same as Scenario 2)

### Scenario 4: Missing User Email Error

**Objective**: Verify form validation for database save

1. Open Desktop Authenticator
2. Log in with valid credentials
3. Select Firefox browser
4. Select Firefox profile
5. Select **"API Database"** or **"Both"** save method
6. Enter:
   - Vinted Email: `test@vinted.es`
   - **Leave Your Account Email empty**
   - Member ID: `12345`
7. Click "Extract & Secure"
8. **Verify**:
   - ✓ Error message appears: "User email is required when saving to database."
   - ✓ No extraction attempt is made

### Scenario 5: Not Authenticated Error

**Objective**: Verify error handling when not logged in

1. Close Desktop Authenticator
2. Manually delete localStorage to clear session:
   ```javascript
   // Open DevTools Console
   localStorage.clear()
   ```
3. Reload app
4. Try to use any save method with database option
5. **Verify**:
   - ✓ Error message appears: "No authenticated session found..."
   - ✓ User is prompted to log in

### Scenario 6: API Connection Error

**Objective**: Verify error handling when API is unreachable

1. Stop vinted-api server
2. Log in to Desktop Authenticator
3. Select Firefox and profile
4. Select **"API Database"** or **"Both"**
5. Enter required fields
6. Click "Extract & Secure"
7. **Verify**:
   - ✓ Error message displays clearly
   - ✓ Suggests checking API server status
   - ✓ Console shows network error details

## CLI Testing

### Test CLI File Save

```bash
# Interactive mode
npm run extract:vinted:firefox
# Select "1" for save method
# Enter required fields
```

### Test CLI Database Save

```bash
# Non-interactive with environment variables
VINTED_EXTRACT_EMAIL=test@vinted.es \
VINTED_USER_EMAIL=user@company.com \
VINTED_MEMBER_ID=12345 \
npm run extract:vinted:firefox
```

**Verify**:
- ✓ CLI completes without errors
- ✓ Success message shows: "✓ Fingerprint stored"
- ✓ Database entry created in vinted_accounts table

## API Testing (curl)

### Test Desktop Session Endpoint Directly

```bash
# 1. Get access token (login endpoint)
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@company.com",
    "password": "your_password"
  }'

# Save the accessToken from response

# 2. Call desktop-session endpoint
curl -X POST http://localhost:3000/api/v1/vinted/auth/desktop-session \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "vintedEmail": "test@vinted.es",
    "browserFingerprint": {
      "extractedAt": "2026-06-28T10:30:00.000Z",
      "browser": "Firefox",
      "userAgent": "Mozilla/5.0...",
      "language": "en-US",
      "timezone": "UTC",
      "screen": { "width": 1920, "height": 1080, "colorDepth": 24 },
      "hardwareConcurrency": 8
    },
    "sessionData": [
      {
        "name": "_vinted_fr_session",
        "value": "test_value",
        "domain": ".vinted.es",
        "path": "/",
        "httpOnly": true,
        "secure": true,
        "sameSite": "Lax"
      }
    ],
    "sessionOrigins": [
      {
        "origin": "https://www.vinted.es",
        "localStorage": [
          { "name": "session_token", "value": "token_xyz" }
        ]
      }
    ],
    "vintedMemberId": "12345"
  }'

# Expected response (201 or 200):
# {
#   "status": "success",
#   "message": "Desktop session stored successfully",
#   "data": {
#     "id": "...",
#     "userId": "...",
#     "vintedEmail": "test@vinted.es",
#     "createdAt": "2026-06-28T10:30:00.000Z",
#     "updatedAt": "2026-06-28T10:30:00.000Z"
#   },
#   "requestId": "..."
# }
```

## Debugging

### Enable Verbose Logging

1. **Desktop Authenticator**:
   - Open DevTools (Ctrl+Shift+I in Electron)
   - Check Console tab for API calls
   - Look for `storeDesktopSession` logs

2. **Vinted API**:
   - Check server logs for POST request to `/api/v1/vinted/auth/desktop-session`
   - Look for status codes: 201 (created) or 200 (updated)

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Network error" when database save | API server not running on port 3000 | Start vinted-api server: `npm run dev` |
| "No authenticated session found" | Not logged in or session expired | Log in again with valid credentials |
| "Missing required fields" | Form validation failed | Ensure all required fields are filled |
| Files not created | File system permission | Check write permissions to `src/modules/vinted/auth/` |
| API returns 401 | Invalid or expired token | Re-login to get fresh token |
| API returns 400 | Invalid request payload | Check that payload matches schema (cookies must have all required fields) |

## Post-Testing Verification

1. **Database Check** (Supabase):
   ```sql
   SELECT * FROM vinted_accounts WHERE vinted_email = 'test@vinted.es';
   ```
   Verify columns are populated:
   - `id` (UUID)
   - `user_id` (UUID of current user)
   - `vinted_email` (populated)
   - `vinted_username` (populated if login successful)
   - `vinted_member_id` (matches entered ID)
   - `firefox_fingerprint` (contains JSON with extraction details)
   - `session_data` (contains array of cookies)
   - `session_origins` (contains array of origins with storage)
   - `created_at` (timestamp)
   - `updated_at` (timestamp)

2. **File Check** (Local):
   ```bash
   # Windows
   cat src/modules/vinted/auth/fingerprint.json
   cat src/modules/vinted/auth/auth-vinted.json
   
   # Linux/Mac
   cat src/modules/vinted/auth/fingerprint.json
   cat src/modules/vinted/auth/auth-vinted.json
   ```

## Performance Metrics

- Extract time: ~2-5 seconds (depends on profile size)
- File save time: <100ms
- API upload time: 1-3 seconds (depends on network)
- Total time (both): ~4-8 seconds

---

## Cleanup After Testing

1. Delete test data from database:
   ```sql
   DELETE FROM vinted_accounts WHERE vinted_email = 'test@vinted.es';
   ```

2. Remove local test files:
   ```bash
   rm -f src/modules/vinted/auth/fingerprint.json
   rm -f src/modules/vinted/auth/auth-vinted.json
   ```

3. Clear browser localStorage (if needed):
   ```javascript
   localStorage.clear()
   ```
