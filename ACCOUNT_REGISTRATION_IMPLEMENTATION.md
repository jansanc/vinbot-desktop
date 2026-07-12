# Account Registration on S3 Upload Implementation

## Overview

When a new Vinted session is successfully uploaded to S3, the system now automatically creates a registry entry in the **`vinted_accounts`** Supabase table using the vinted-api endpoints.

## Changes Made

### 1. **SessionUploadService** (`src/modules/vinted/session/sessionUpload.service.ts`)

#### New Interface: `VintedAccountRegistry`
```typescript
export interface VintedAccountRegistry {
  vinted_email: string;
  vinted_member_id?: string;
  user_email: string;
  status: "active" | "inactive" | "pending";
  source: "desktop_authenticator" | "manual" | "api";
}
```

#### New Method: `registerVintedAccount()`
- **Purpose**: Register a Vinted account in the `vinted_accounts` table
- **Endpoint**: `POST /api/v1/integrations/vinted/accounts/register`
- **Request Body**: VintedAccountRegistry object
- **Features**:
  - Sets status to "active" by default
  - Sets source to "desktop_authenticator" for tracking upload origin
  - Doesn't fail the entire flow if registration fails (graceful degradation)
  - Logs warnings instead of errors

#### Enhanced Method: `uploadSessionToAPI()`
- **Previous**: Uploaded session to S3 and returned
- **Now**: After successful upload, automatically calls `registerVintedAccount()`
- **Behavior**: Registration failure doesn't break the upload flow

### 2. **IPC Handlers** (`src/main/ipc-handlers.ts`)

#### Interactive Login Flow
- **Handler**: `vinted:interactiveLogin`
- **Location**: After successful profile upload to S3
- **Action**: Calls `SessionUploadService.registerVintedAccount()` with:
  - `userEmail`: User's email (from app)
  - `vintedEmail`: Vinted email (entered by user)
  - `vintedMemberId`: Optional Vinted member ID
  - `accessToken`: Auth token for API call
- **Progress Events**:
  - `REGISTER_START`: Registration initiated
  - `REGISTER_COMPLETE`: Account registered with ID
  - `REGISTER_WARNING`: Non-blocking registration note

#### Batch Upload Flow
- **Handler**: `vinted:batchUploadProfiles`
- **Location**: After each profile is successfully uploaded
- **Action**: Registers account for each uploaded profile
- **Behavior**: Registration doesn't block the batch upload

## API Endpoint

**Endpoint**: `POST /api/v1/integrations/vinted/accounts/register`

**Request Body**:
```json
{
  "vinted_email": "user@vinted.com",
  "vinted_member_id": "12345",
  "user_email": "user@app.com",
  "status": "active",
  "source": "desktop_authenticator"
}
```

**Headers**:
```
Content-Type: application/json
Authorization: Bearer {accessToken}
```

**Response** (Expected):
```json
{
  "status": "success",
  "message": "Account registered successfully",
  "data": {
    "id": "account_registry_id"
  }
}
```

## Flow Diagrams

### Interactive Login with Account Registration
```
1. User enters Vinted email
2. Browser opens for login
3. User logs in and closes browser
4. Profile extracted and compressed to tar.gz
5. Profile uploaded to S3
   ↓
6. Account registered in vinted_accounts table
   ├─ Success: Logged with account ID
   └─ Failure: Logged as warning (doesn't break flow)
7. Success message shown to user
```

### Batch Upload with Account Registration
```
For each profile in batch:
1. Compress profile to tar.gz
2. Upload to S3
   ↓
3. Register account in vinted_accounts table
   ├─ Success: Continue to next profile
   └─ Failure: Continue to next profile (warning logged)
4. Return batch results
```

## Error Handling

- **Network Errors**: Logged as warnings, don't block upload flow
- **Auth Errors**: Gracefully handled, registration note included in response
- **Invalid Response**: Caught and logged, upload flow continues

## Logging

All registration events are logged to the console with `[SessionUploadService]` prefix:
- `✓ Account registered (ID: ...)`
- `Account registration warning: ...`
- `Registration note: ...`

## Benefits

1. **Automatic Tracking**: Accounts are registered without user intervention
2. **Central Registry**: All Vinted accounts are tracked in one table
3. **Audit Trail**: Source is tracked ("desktop_authenticator")
4. **Non-Blocking**: Registration failures don't break the upload flow
5. **Robust**: Handles network and API errors gracefully

## Database Schema Expectations

The `vinted_accounts` table should have these columns:
- `id`: Primary key (UUID or auto-increment)
- `vinted_email`: Vinted user email
- `vinted_member_id`: Optional Vinted member ID
- `user_email`: App user email
- `status`: Account status (active/inactive/pending)
- `source`: Registration source (desktop_authenticator/manual/api)
- `created_at`: Timestamp
- `updated_at`: Timestamp (optional)

## Testing

To test the implementation:

1. **Interactive Login**:
   - Enter Vinted email
   - Complete login flow
   - Check S3 upload succeeds
   - Verify registration call is made (check console logs)

2. **Batch Upload**:
   - Upload multiple profiles
   - Each should register an account after S3 upload
   - Verify all registrations complete

3. **Error Scenarios**:
   - Disable the registration endpoint
   - Upload should still complete (graceful degradation)
   - Warning should be logged

## Future Enhancements

- Add account status management (update status on next login)
- Track last login date
- Add deactivation logic
- Implement account activity monitoring
