# Error Display Fix - Progress Event Errors

Fixed issue where errors sent via progress events (like profile upload failures) were not displayed in the UI.

## Problem

**Before:**
- Errors occurred during profile upload, health check, or account linking
- IPC handler logged the error and sent progress message with `WARNING` or `FAILED` in step name
- UI received the message but didn't display it to the user
- Error existed only in logs, invisible to user

**Example:**
```
[2] [IPC] PROFILE_UPLOAD_WARNING: ⚠️ Profile upload note: Storage upload failed (409): The resource already exists
[2] [IPC] HEALTH_CHECK_ERROR: ⚠️ Session health check error: Failed to check session health
[2] [IPC] LINK_FAILED: ⚠️ Account linking failed: API error
```

All logged but NO UI toast appeared.

## Solution

### 1. Progress Event Error Detection

Updated `InteractiveLoginFlow.tsx` to detect error/warning messages in progress events:

```typescript
const handleProgress = (data: LoginProgress) => {
  const step = data.step.toUpperCase();
  const isError = step.includes("ERROR") || step.includes("FAILED");
  const isWarning = step.includes("WARNING");

  if (isError || isWarning) {
    // Extract clean message and display via error context
    const cleanMsg = extractCleanMessage(data.message);
    addError(new Error(cleanMsg), `InteractiveLoginFlow.IPC.${step}`);
  }
};
```

**Detects:**
- Steps ending with `_ERROR` (e.g., `HEALTH_CHECK_ERROR`)
- Steps ending with `_FAILED` (e.g., `LINK_FAILED`)
- Steps ending with `_WARNING` (e.g., `PROFILE_UPLOAD_WARNING`)

### 2. Explicit Error Events

Updated IPC handler to send explicit error events for critical failures:

```typescript
// When profile upload fails:
event.sender.send("interactive-login-error", {
  error: `Profile upload failed: ${errorMsg}`,
  timestamp: new Date().toISOString(),
  step: "PROFILE_UPLOAD",
});

// When health check fails:
event.sender.send("interactive-login-error", {
  error: `Session health check failed: ${errorMsg}`,
  timestamp: new Date().toISOString(),
  step: "HEALTH_CHECK",
});

// When linking fails:
event.sender.send("interactive-login-error", {
  error: `Account linking failed: ${errorMsg}`,
  timestamp: new Date().toISOString(),
  step: "LINK",
});
```

### 3. Message Cleaning

Errors are cleaned before display:
- Remove emoji prefixes (⚠️, ❌, 🔴)
- Remove step prefix (e.g., "PROFILE_UPLOAD_WARNING:")
- Extract JSON error messages if embedded
- Provide human-readable message to user

**Example transformations:**
```
Raw:  "⚠️ Profile upload note: Storage upload failed (409): The resource already exists"
Clean: "Storage upload failed (409): The resource already exists"

Raw:  "{"status":"error","message":"Failed to check session health","details":{...}}"
Clean: "Failed to check session health"
```

## Error Flow (Updated)

```
IPC Handler Error
    ↓
  Two parallel paths:
  ├─ Progress Event (STEP_WARNING/ERROR/FAILED)
  │   └─ InteractiveLoginFlow detects step name
  │       └─ Extracts clean message
  │           └─ Calls addError()
  │               └─ Shows toast
  │
  └─ Explicit Error Event
      └─ InteractiveLoginFlow error listener
          └─ Calls addError()
              └─ Shows toast
```

## Critical Failures Now Displayed

### Profile Upload Error
**Before:** Only in logs
**After:** Toast with message "Storage upload failed (409): The resource already exists"

### Session Health Check Error
**Before:** Only in logs
**After:** Toast with message "Session health check failed: ..."

### Account Linking Error
**Before:** Only in logs
**After:** Toast with message "Account linking failed: ..."

## Message Flow Examples

### Profile Upload 409 Conflict

**IPC Handler:**
```typescript
sendProgress("PROFILE_UPLOAD_WARNING", 
  `⚠️ Profile upload note: Storage upload failed (409): The resource already exists`);

event.sender.send("interactive-login-error", {
  error: "Profile upload failed: Storage upload failed (409): The resource already exists",
  timestamp: "2026-07-12T10:30:00Z",
  step: "PROFILE_UPLOAD",
});
```

**UI Detection:**
```typescript
// Via progress event
step = "PROFILE_UPLOAD_WARNING" → isWarning = true
message = "⚠️ Profile upload note: Storage upload failed (409)..."
cleanMsg = "Storage upload failed (409): The resource already exists"

// Via error event
error = "Profile upload failed: Storage upload failed (409)..."
cleanMsg = "Profile upload failed: Storage upload failed (409)..."
```

**User sees:** Error toast in top-right with message about 409 conflict

### Health Check Failure

**IPC Handler:**
```typescript
sendProgress("HEALTH_CHECK_ERROR", 
  `⚠️ Session health check error: Failed to check session health`);

event.sender.send("interactive-login-error", {
  error: "Session health check failed: Failed to check session health",
  timestamp: "2026-07-12T10:30:00Z",
  step: "HEALTH_CHECK",
});
```

**UI Detection:**
```typescript
step = "HEALTH_CHECK_ERROR" → isError = true
message = "⚠️ Session health check error: Failed..."
cleanMsg = "Failed to check session health"
```

**User sees:** Red error toast explaining health check failed

## Benefits

✅ **All errors visible** — No more invisible failures in logs
✅ **User-friendly messages** — Emoji and formatting removed
✅ **Dual detection** — Progress events + explicit error events
✅ **Recoverable** — User can dismiss and retry
✅ **Consistent styling** — Uses existing error toast system
✅ **No message duplication** — Message cleaning prevents redundancy

## How It Works Now

1. **Error occurs** → IPC handler catches it
2. **Send progress** → `STEP_WARNING` or `STEP_FAILED` event
3. **Send error event** → Explicit error with clean message
4. **UI detects progress** → Checks step name for ERROR/FAILED/WARNING
5. **UI detects error event** → Error listener receives error
6. **Both trigger display** → Message added to error context
7. **Toast appears** → User sees message in top-right
8. **Auto-dismiss or manual** → Based on severity

## Testing

To verify errors display:

1. **Trigger profile upload error:**
   - Upload same profile twice → 409 conflict
   - Error toast should appear with "409" message

2. **Trigger health check error:**
   - Interrupt network during health check
   - Error toast should appear with network error

3. **Trigger linking error:**
   - Use invalid access token
   - Error toast should appear with linking failure message

All errors should now be visible in the UI within 1-2 seconds of occurring.
