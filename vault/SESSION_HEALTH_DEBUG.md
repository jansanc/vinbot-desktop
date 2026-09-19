# Session Health Check Debugging Guide

Comprehensive debugging logs added to trace session validation flow end-to-end.

## Log Flow

### 1. Desktop App (Client-Side Logs)

**Location:** Browser Console → Device logs

```
[SessionUploadService] Checking session health:
{
  vintedEmail: "user@vinted.com",
  endpoint: "http://localhost:3001/api/v1/integrations/vinted/session/health",
  cookieCount: 5,
  cookies: [
    {
      name: "vinted_session",
      hasDomain: true,
      hasValue: true,
      valueLength: 45,
      secure: true,
      httpOnly: true,
      path: "/",
      expires: 1720000000
    },
    ...
  ]
}
```

**What to look for:**
- ✅ `cookieCount > 0` — Cookies are being extracted
- ✅ Cookie names contain "vinted", "_session", or start with "_"
- ✅ `valueLength > 10` — Cookies have actual values, not empty
- ✅ `secure: true, httpOnly: true` — Proper security flags

**Red flags:**
- ❌ `cookieCount: 0` — No cookies extracted
- ❌ `valueLength: 0` — Empty cookie values
- ❌ Missing security flags — Might indicate placeholder cookies

### 2. Payload Details

```
[SessionUploadService] Payload being sent:
{
  vintedEmail: "user@vinted.com",
  sessionDataCount: 5,
  sessionDataDetails: [
    {
      name: "vinted_session",
      valueSample: "abc123def456ghi...",
      valueLength: 45
    },
    ...
  ]
}
```

**What to check:**
- Session data count matches cookie count
- Value samples show actual data (not "empty" or "placeholder")
- At least one cookie should look like a real session token

### 3. Backend Logs (Server)

**Location:** Backend console / logs

#### Controller Level

```
[IntegrationsController] checkSessionHealth - REQUEST
{
  requestId: "req-123-abc",
  vintedEmail: "user@vinted.com",
  sessionDataCount: 5,
  hasAuth: true,
  timestamp: "2026-07-12T10:30:00Z"
}

[IntegrationsController] Received session data
{
  requestId: "req-123-abc",
  cookies: [
    {
      name: "vinted_session",
      hasDomain: true,
      hasPath: true,
      valueLength: 45,
      secure: true,
      httpOnly: true
    },
    ...
  ]
}
```

#### Service Level

```
[IntegrationsService] checkSessionHealth - START
{
  vintedEmail: "user@vinted.com",
  cookieCount: 5,
  timestamp: "2026-07-12T10:30:00Z"
}

[IntegrationsService] Received cookies
{
  cookieNames: ["vinted_session", "_fr_session", "session_id", "user_pref", "csrf_token"],
  totalCookies: 5,
  cookieDetails: [
    {
      name: "vinted_session",
      valueLength: 45,
      domain: ".vinted.com",
      path: "/",
      secure: true,
      httpOnly: true
    },
    ...
  ]
}

[IntegrationsService] Cookie analysis
{
  "vinted_session": {
    "hasSession": true,
    "hasVinted": true,
    "hasUnderscorePrefix": false,
    "hasFragmentRedirect": false,
    "isSession": true,
    "valueNotEmpty": true
  },
  "_fr_session": {
    "hasSession": true,
    "hasVinted": false,
    "hasUnderscorePrefix": true,
    "hasFragmentRedirect": true,
    "isSession": true,
    "valueNotEmpty": true
  },
  ...
}

[IntegrationsService] Critical cookies check
{
  hasCriticalCookies: true,
  totalChecked: 5
}

[IntegrationsService] Session health validation result
{
  vintedEmail: "user@vinted.com",
  healthy: true,
  profileValid: true,
  cookieCount: 5,
  hasCriticalCookies: true,
  emailValid: true,
  reasoning: {
    statusReason: "Session looks valid",
    criticalCookiesFound: true,
    allCookiesPresent: true
  }
}

[IntegrationsService] checkSessionHealth - RESPONSE
{
  response: {
    healthy: true,
    profileValid: true,
    profile: {
      email: "user@vinted.com",
      country: "ES"
    }
  },
  timestamp: "2026-07-12T10:30:00Z"
}
```

#### Final Response

```
[IntegrationsController] checkSessionHealth - RESPONSE
{
  requestId: "req-123-abc",
  response: {
    healthy: true,
    profileValid: true,
    profile: {
      email: "user@vinted.com",
      country: "ES"
    }
  },
  timestamp: "2026-07-12T10:30:00Z"
}
```

### 4. Desktop App Response Parsing

```
[SessionUploadService] Health check response received:
{
  fullResponse: "{\"status\":\"success\",\"message\":\"Session health checked successfully\",\"data\":{\"healthy\":true,\"profileValid\":true,\"profile\":{\"email\":\"user@vinted.com\",\"country\":\"ES\"}},\"requestId\":\"req-123-abc\"}",
  status: "success",
  message: "Session health checked successfully"
}

[SessionUploadService] Session health check result parsed:
{
  healthy: true,
  profileValid: true,
  hasProfile: true,
  profileKeys: ["email", "country"],
  profile: {
    email: "user@vinte...",
    country: "ES"
  },
  dataPath: {
    "data.data.healthy": undefined,
    "data.healthy": true,
    "data.profileValid": true,
    "data.data.profileValid": undefined
  }
}
```

## Debugging Checklist

### Session Claims to Be Invalid But Logs Show Valid

1. **Check client-side logs:**
   - [ ] Are cookies being extracted? (`cookieCount > 0`)
   - [ ] Do cookie names match patterns? (contains "vinted", "_session", "_")
   - [ ] Are values non-empty? (`valueLength > 10`)

2. **Check backend logs:**
   - [ ] Are cookies received by controller? (`sessionDataCount > 0`)
   - [ ] Cookie details logged with full inspection
   - [ ] Cookie analysis showing which patterns matched
   - [ ] Critical cookies found? (`hasCriticalCookies: true`)

3. **Cross-reference both sides:**
   - [ ] Client sends N cookies → Backend receives N cookies?
   - [ ] Client logs cookie names match backend received names?
   - [ ] Value lengths match on both sides?

### Session Should Be Valid But Logs Show Invalid

1. **Missing critical cookies:**
   - Check `[IntegrationsService] Received cookies`
   - Cookie names should include: `_session`, `vinted`, `_fr`, or start with `_`
   - If missing, browser extraction might have failed

2. **Empty cookie values:**
   - Check `[IntegrationsService] Cookie analysis`
   - Look for `"valueNotEmpty": false`
   - Indicates placeholder or corrupted cookies

3. **Email validation failed:**
   - Check `[IntegrationsService] Session health validation result`
   - Look for `emailValid: false`
   - Email must contain "@" character

## Real vs Placeholder Cookies

### Real Cookie Example
```json
{
  "name": "_vinted_fr_session",
  "value": "eyJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uX2lkIjoiNDU2Nzg5MCJ9",
  "valueLength": 48,
  "secure": true,
  "httpOnly": true,
  "domain": ".vinted.com",
  "path": "/"
}
```

### Placeholder Cookie Example (Invalid)
```json
{
  "name": "vinted_login_timestamp",
  "value": "2026-07-12T10:30:00.000Z",
  "valueLength": 24,
  "secure": true,
  "httpOnly": false,
  "domain": ".vinted.com",
  "path": "/"
}
```

⚠️ **Placeholder cookies:**
- Have timestamps as values
- Short names without underscores
- May have `httpOnly: false`
- Look for "timestamp", "placeholder", "login_time" in value

## How to Enable Debug Logging

### Backend
Logs are automatically enabled at INFO level. Check:
```
NODE_ENV=development
LOG_LEVEL=info
```

### Desktop App
Check browser console (DevTools):
```
F12 → Console tab → Filter by "[SessionUploadService]"
```

## Expected Valid Session Indicators

✅ **All of these should be true for valid session:**
1. `cookieCount >= 3` (minimum session cookies)
2. At least one cookie contains "vinted" or "_session"
3. At least one cookie starts with "_"
4. All cookie values > 20 characters
5. `secure: true` on most cookies
6. Email contains "@" and matches Vinted domain
7. Final response shows `healthy: true` and `profileValid: true`

## Common Issues & Fixes

| Issue | Logs Show | Fix |
|-------|-----------|-----|
| No cookies extracted | `cookieCount: 0` | Check browser profile extraction |
| Placeholder cookies | Values look like timestamps | Use real browser session, not mock data |
| Empty values | `valueLength: 0` | Verify cookie extraction didn't fail |
| Missing email | `emailValid: false` | Provide valid Vinted email in UI |
| Network error | 401/500 in logs | Check backend is running |

## Next Steps When Debugging

1. **Collect all three log sections** (client, controller, service)
2. **Compare cookie counts** on both sides
3. **Verify cookie names** match patterns for critical cookies
4. **Check value lengths** are reasonable (>20 chars for real cookies)
5. **Look for error messages** in any of the three sections
6. **Cross-reference timestamps** to ensure logs are from same request
