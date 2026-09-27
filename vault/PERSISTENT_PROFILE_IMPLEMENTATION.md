# Persistent Profile S3 Implementation

**Status**: ✅ Step 1 Complete (Desktop App)  
**Date**: July 15, 2026  
**Purpose**: Enable backend token refresh by using persistent S3 profile paths instead of timestamps

---

## Overview

Profiles are now stored with **persistent, account-based identifiers** instead of temporary timestamps. This allows the backend integration layer to:

1. Download a persistent profile from S3
2. Detect when tokens expire
3. Refresh the session using the profile
4. Upload the refreshed profile back to S3
5. Continue operations with fresh tokens

---

## What Changed

### Desktop App (✅ Implemented)

#### Before (Temporary)
```
s3://browser-profiles/profiles/{timestamp}-{randomId}.tar.gz
Example: profiles/1720725600000_yjfjd05sppb/profile.tar.gz
Problem: No way to refresh - profile is discarded after use
```

#### After (Persistent)
```
s3://browser-profiles/profiles/{userId}/{vintedMemberId}/{browser}.tar.gz
Example: profiles/user_abc123/vinted_member_xyz/chrome.tar.gz
Benefit: Same path overwrites old profile with refreshed version
```

---

## Implementation Details

### 1. S3 Path Utility (`src/utils/s3-paths.ts`)

New utility for constructing persistent paths:

```typescript
constructProfileS3Path(
  userId: string,           // User's email (sanitized)
  vintedMemberId: string,   // Vinted account ID
  browser: "chrome" | "firefox" | "edge"
): ProfileS3Path

// Returns:
{
  bucket: "browser-profiles",
  key: "profiles/user_abc123/vinted_member_xyz/chrome.tar.gz",
  fullPath: "s3://browser-profiles/profiles/user_abc123/vinted_member_xyz/chrome.tar.gz"
}
```

### 2. Interactive Login Handler (`src/main/ipc-handlers.ts`)

Updated profile upload section:

**New Headers Sent**:
```typescript
headers = {
  "x-s3-key": "profiles/user_abc123/vinted_member_xyz/chrome.tar.gz",  // ← NEW
  "x-browser": "chrome",
  "x-vinted-member-id": "member_xyz",
  "x-user-email": "user@example.com",
  // ... other headers
}

metadata = {
  s3Path: "s3://browser-profiles/profiles/user_abc123/vinted_member_xyz/chrome.tar.gz",  // ← NEW
  type: "interactive-login",
  // ... other metadata
}
```

### 3. Session Upload Service (`src/modules/vinted/session/sessionUpload.service.ts`)

Already supports passing persistent profile S3 path to backend:

```typescript
await SessionUploadService.linkVintedAccount(extractedSession, {
  userEmail: "user@example.com",
  vintedEmail: "user@vinted.es",
  vintedMemberId: "member_xyz",
  accessToken: "token_...",
  profileS3: "profiles/user_abc123/vinted_member_xyz/chrome.tar.gz",  // ← Persistent path
});
```

---

## Backend Integration Required

### Endpoint: `POST /api/v1/integrations/vinted/profile/upload`

The backend needs to:

1. **Accept Headers**:
   ```
   x-s3-key: profiles/user_abc123/vinted_member_xyz/chrome.tar.gz
   x-browser: chrome
   x-vinted-member-id: member_xyz
   x-user-email: user@example.com
   x-vinted-email: user@vinted.es
   ```

2. **Store in Database**:
   ```sql
   UPDATE vinted_accounts 
   SET profile_s3 = 'profiles/user_abc123/vinted_member_xyz/chrome.tar.gz',
       profile_browser = 'chrome',
       profile_uploaded_at = NOW()
   WHERE vinted_member_id = 'member_xyz' 
     AND user_id = 'user_xyz';
   ```

3. **Return Response**:
   ```json
   {
     "status": "success",
     "data": {
       "id": "profile_upload_123",
       "s3Key": "profiles/user_abc123/vinted_member_xyz/chrome.tar.gz",
       "storagePath": "s3://browser-profiles/profiles/user_abc123/vinted_member_xyz/chrome.tar.gz",
       "bucket": "browser-profiles"
     }
   }
   ```

---

## Next Steps: Backend Profile Refresh (Step 2)

Once this is deployed, implement the backend refresh service:

### New Endpoint: `POST /api/v2/profiles/refresh`

```python
# Python FastAPI endpoint
@router.post("/profiles/refresh")
async def refresh_vinted_session(
    account_id: str,
    force: bool = False
):
    """
    1. Download persistent profile from S3
    2. Extract and load in Playwright browser
    3. Navigate to Vinted to check token expiry
    4. If expired, trigger re-authentication
    5. Save fresh cookies
    6. Recompress and upload refreshed profile back to S3
    7. Return fresh session cookies for immediate use
    """
    vinted_account = db.query(VintedAccount).filter(
        VintedAccount.id == account_id
    ).first()
    
    if not vinted_account.profile_s3:
        raise HTTPException(
            status_code=400,
            detail="No persistent profile available for this account"
        )
    
    # Step 1: Download from S3
    profile_archive = download_from_s3(vinted_account.profile_s3)
    
    # Step 2: Extract and load in browser
    async with playwright.async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()
        
        # Load the persistent profile's cookies/storage
        await context.add_cookies(vinted_account.session_data)
        
        # Step 3: Check if tokens are still valid
        await page.goto("https://www.vinted.es")
        is_authenticated = await check_authentication(page)
        
        if not is_authenticated or force:
            # Step 4: Trigger re-authentication
            await re_authenticate(page, vinted_account)
        
        # Step 5: Save fresh cookies
        cookies = await context.cookies()
        
        # Step 6: Recompress and upload
        new_profile_archive = compress_browser_state(context, cookies)
        upload_to_s3(vinted_account.profile_s3, new_profile_archive)
        
        # Step 7: Update database
        db.query(VintedAccount).filter(
            VintedAccount.id == account_id
        ).update({
            "session_data": cookies,
            "profile_refreshed_at": datetime.now(),
            "token_status": "fresh"
        })
        
        return {
            "status": "success",
            "profile_refreshed": True,
            "cookies": cookies,
            "profile_s3": vinted_account.profile_s3
        }
```

---

## Database Schema (Already In Place)

The `vinted_accounts` table already has the fields needed:

```sql
ALTER TABLE vinted_accounts ADD COLUMN IF NOT EXISTS profile_s3 TEXT;
ALTER TABLE vinted_accounts ADD COLUMN IF NOT EXISTS profile_browser VARCHAR(20);
ALTER TABLE vinted_accounts ADD COLUMN IF NOT EXISTS profile_uploaded_at TIMESTAMP;
ALTER TABLE vinted_accounts ADD COLUMN IF NOT EXISTS profile_refreshed_at TIMESTAMP;
ALTER TABLE vinted_accounts ADD COLUMN IF NOT EXISTS token_status VARCHAR(20) DEFAULT 'unknown';
```

---

## Flow Diagram

```
User clicks "Extract & Upload" in Desktop App
    ↓
Interactive Login → Browser opens → User logs in
    ↓
Extract Profile + Session Data
    ↓
Construct Persistent S3 Path:
    profiles/user_abc123/vinted_member_xyz/chrome.tar.gz
    ↓
Upload to S3 (with x-s3-key header)
    ↓
Backend receives upload → stores path in vinted_accounts.profile_s3
    ↓
Link account with persistent profile reference
    ↓
✅ Account linked with persistent profile
    ↓
[Scheduled Job or Manual Trigger]
    ↓
Backend: GET /api/v2/profiles/refresh?account_id=xyz
    ↓
Backend: Download profile from persistent S3 path
    ↓
Backend: Reload browser → Detect expired tokens
    ↓
Backend: Refresh session → Get fresh cookies
    ↓
Backend: Recompress & upload to SAME persistent S3 path
    ↓
✅ Profile refreshed with fresh tokens
    ↓
Next automation job uses fresh profile → ✅ Succeeds
```

---

## Testing Checklist

- [x] Desktop app constructs persistent S3 paths correctly
- [x] Headers include `x-s3-key` with persistent path
- [x] Metadata includes full S3 path in JSON
- [ ] Backend receives and stores `x-s3-key` in database
- [ ] Backend returns persistent S3 path in response
- [ ] Subsequent uploads overwrite old profile (same S3 key)
- [ ] Backend refresh endpoint downloads from persistent path
- [ ] Refresh updates profile and cookies in database
- [ ] Refreshed profile has fresh tokens

---

## Configuration

### Desktop App (.env)
```
REACT_APP_API_URL=http://localhost:3001
```

### Backend (.env)
```
SUPABASE_URL=https://...
SUPABASE_KEY=...
AWS_S3_BUCKET=browser-profiles
```

---

## Files Modified

1. **Created**: `src/utils/s3-paths.ts` — Persistent path construction
2. **Modified**: `src/main/ipc-handlers.ts` — Use persistent paths in upload
3. **No changes needed**: `src/modules/vinted/session/sessionUpload.service.ts` — Already supports profileS3

---

## Benefits

✅ **Persistent Identity**: Profiles tied to accounts, not timestamps  
✅ **Automatic Refresh**: Backend can refresh tokens without user interaction  
✅ **Cost Efficient**: Reuse same S3 location (overwrites old)  
✅ **Audit Trail**: Clear S3 path for debugging and tracking  
✅ **Scalable**: Supports unlimited account-based profiles  

---

## Rollback

If needed, the desktop app can still work without persistent paths:
- Just remove the `x-s3-key` header
- Backend will handle timestamp-based uploads as before
- But no automatic refresh will be possible

---

**Next Step**: Implement Step 2 (Backend Profile Refresh Service)
