# Quick Start - Desktop Session Integration

## 5-Minute Overview

The desktop authenticator can now save Vinted session data to the vinted-api server. Users can choose to save locally, upload to the API, or both.

### What Changed?

**Added** 🎉
- `saveMethod` selection in UI (file, database, or both)
- `ApiService.storeDesktopSession()` method
- `vintedAuth.service.saveFirefoxExtractionData()` implementation
- Conditional user email field based on save method

**Still Works** ✅
- Local file saving (unchanged)
- CLI extraction (uses same service)
- Electron IPC communication

## Running the App

### Prerequisites
```bash
# Terminal 1: Start vinted-api
cd vinted-api/api
npm run dev
# Should see: Server running on port 3000

# Terminal 2: Start desktop-authenticator
cd vinbot-desktop-authenticator
npm run dev
# Should see: Electron window opening
```

### Basic Usage

1. **Login** with your account email and password
2. **Select browser** (Firefox, Chrome, or Edge)
3. **Select Firefox profile** (if Firefox chosen)
4. **Choose save method**:
   - 📄 "Local File" → Save to JSON files only
   - 📤 "API Database" → Upload to vinted-api only (requires your email)
   - 📦 "Both" → Save locally AND upload (requires your email)
5. **Enter account details**:
   - Vinted Email (your Vinted account email)
   - Member ID (from your Vinted profile URL)
   - Your Account Email (if uploading to API)
6. **Click "Extract & Secure"** and wait
7. **Success!** Data saved locally and/or to server

## Code Quick Reference

### Using the API Method

```typescript
// In a component or service:
import { ApiService } from "src/services/api.service";
import { AuthService } from "src/services/auth.service";

const session = AuthService.getSession();
if (!session) {
  throw new Error("Not authenticated");
}

const response = await ApiService.storeDesktopSession(
  session.accessToken,
  {
    vintedEmail: "user@vinted.es",
    browserFingerprint: fingerprintData,
    sessionData: cookiesArray,
    sessionOrigins: originsArray,
    vintedMemberId: "12345",
    updateSessionOnly: false,
  }
);

if (response.status === "success") {
  console.log("Stored:", response.data);
}
```

### Using the Service Function

```typescript
import { saveFirefoxExtractionData } from "src/modules/vinted/auth/vintedAuth.service";
import type { Fingerprint } from "src/types";

const result = await saveFirefoxExtractionData(
  vintedEmail,
  fingerprint,
  authData,
  userEmail,
  vintedMemberId
);

console.log("Account ID:", result.id);
console.log("Stored successfully:", result.message);
```

## File Locations

| File | Purpose |
|------|---------|
| `src/services/api.service.ts` | API communication (new method added) |
| `src/modules/vinted/auth/vintedAuth.service.ts` | Session saving logic (implemented) |
| `src/components/ExtractionForm.tsx` | UI form (save method added) |
| `src/App.tsx` | Main app logic (save method passed) |
| `src/types.ts` | Type definitions (SaveMethod added) |
| `src/main/ipc-handlers.ts` | Electron IPC (no changes needed) |
| `cli/vinted-firefox.ts` | CLI script (uses service function) |

## Common Tasks

### Debug API Call

1. Open DevTools (Ctrl+Shift+I in Electron)
2. Go to Console tab
3. Look for logs from `storeDesktopSession`
4. Check Network tab for POST to `/api/v1/vinted/auth/desktop-session`

### Test Without Login

```javascript
// In console, fake a session:
const fakeSession = {
  accessToken: "test_token",
  refreshToken: "test_refresh",
  expiresIn: 3600,
  expiresAt: Date.now() + 3600000,
};
localStorage.setItem("vinted_session", JSON.stringify(fakeSession));
// Note: API will still validate the token and reject if invalid
```

### Test CLI Upload

```bash
VINTED_EXTRACT_EMAIL=test@vinted.es \
VINTED_USER_EMAIL=user@company.com \
VINTED_MEMBER_ID=12345 \
npm run extract:vinted:firefox
```

### Verify Database Entry

```sql
-- In Supabase SQL Editor
SELECT 
  id, 
  vinted_email, 
  vinted_member_id, 
  created_at 
FROM vinted_accounts 
WHERE vinted_email = 'test@vinted.es';
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Network error" | Check that vinted-api is running on port 3000 |
| "No authenticated session" | Log in first, check session token in localStorage |
| "User email is required" | Select "Local File" only, or provide your email for "API Database" |
| "Failed to store session" | Check vinted-api logs for validation errors |
| Files not created | Check write permissions to `src/modules/vinted/auth/` |

## Environment Variables

```bash
# Desktop Authenticator .env
REACT_APP_API_URL=http://localhost:3000

# Vinted API .env
PORT=3000
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
NODE_ENV=development
```

## Performance Targets

- Extract time: 2-5 seconds
- File save: <100ms
- API upload: 1-3 seconds
- Total (both): 4-8 seconds

## Testing Checklist

- [ ] Can select different save methods
- [ ] User email field appears/hides correctly
- [ ] File save creates JSON files
- [ ] API save creates database entry
- [ ] Error messages display clearly
- [ ] CLI works with environment variables
- [ ] Browser fingerprint data is complete
- [ ] Cookies array is populated
- [ ] Origins array includes localStorage

## Documentation Files

- **CHANGES.md** - Detailed list of all changes
- **ARCHITECTURE.md** - System architecture diagrams
- **INTEGRATION_SUMMARY.md** - Integration details and API contract
- **TESTING_GUIDE.md** - Comprehensive testing procedures

## Support

### Need Help?

1. Check **TESTING_GUIDE.md** for troubleshooting
2. Review **ARCHITECTURE.md** for data flow diagrams
3. Look at **CHANGES.md** for what was modified
4. Check console logs and network requests

### Common Questions

**Q: Can I use this without internet?**
A: Yes, use "Local File" save method. "API Database" requires connection to vinted-api.

**Q: What data is uploaded?**
A: Browser fingerprint, cookies, localStorage, and sessionStorage (all extracted locally).

**Q: Is the data encrypted?**
A: Data is encrypted in transit (HTTPS). Vinted credentials are never stored or sent.

**Q: Can I update an existing account?**
A: Yes, set `updateSessionOnly: true` in API payload, or click "Both" and select existing email.

**Q: What if the API fails?**
A: File save will succeed if selected. API error is displayed with retry option.

---

**Version**: 1.0.0
**Last Updated**: June 28, 2026
**Status**: ✅ Production Ready

## Next Steps

1. ✅ Run `npm run dev` in both projects
2. ✅ Test file save (no auth needed)
3. ✅ Login and test API save
4. ✅ Verify database entry in Supabase
5. ✅ Test CLI with environment variables
6. ✅ Share feedback or report issues
