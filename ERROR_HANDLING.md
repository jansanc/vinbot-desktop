# Error Handling System

Comprehensive error handling with automatic classification, logging, and user-friendly UI notifications.

## Architecture

### 1. ErrorHandler Utility (`src/utils/errorHandler.ts`)

Core error handling service that:
- **Classifies errors** into specific error codes
- **Maps errors to user-friendly messages**
- **Logs errors with context** for debugging
- **Creates structured AppError objects**

**Error Codes:**
- `VALIDATION_ERROR` - User input validation failed
- `NETWORK_ERROR` - Network/connectivity issues
- `AUTH_ERROR` - Authentication failures
- `SESSION_ERROR` - Session-related issues
- `HEALTH_CHECK_ERROR` - Session health check failed
- `UPLOAD_ERROR` - Upload operation failed
- `BROWSER_ERROR` - Browser operation failed
- `TIMEOUT_ERROR` - Operation timeout
- `API_ERROR` - Server/API errors
- `UNKNOWN_ERROR` - Uncategorized errors

**Usage:**
```typescript
// Classify and handle an error
const appError = ErrorHandler.handle(error);

// Create a specific error
const error = ErrorHandler.createError(
  "VALIDATION_ERROR",
  "Email is required",
  { field: "email" }
);

// Format error message for display
const message = ErrorHandler.formatErrorMessage(error);

// Log error with context
ErrorHandler.log(appError, "ComponentName");
```

### 2. ErrorContext (`src/contexts/ErrorContext.tsx`)

React Context that manages errors globally in the app:
- Stores error list
- Provides `addError()`, `removeError()`, `clearErrors()` methods
- Auto-removes non-critical errors after 8 seconds

**Usage:**
```typescript
import { useError } from "../contexts/ErrorContext";

const MyComponent = () => {
  const { errors, addError, removeError } = useError();
  
  const handleOperation = async () => {
    try {
      // ... operation code
    } catch (err) {
      addError(err, "MyComponent.handleOperation");
    }
  };
};
```

### 3. ErrorToast Components (`src/components/ErrorToast.tsx`)

UI components for displaying errors:

**ErrorToast** - Individual error notification
- Shows error severity (critical, error, warning, info)
- Displays user-friendly message with original error detail
- Dismiss button to close individual errors
- Animated entrance effect

**ErrorToastContainer** - Container for error stack
- Renders multiple errors as a stack
- Fixed position (top-right corner)
- Auto-removed errors disappear with animation

**Styling:**
- **Critical/Error** - Red with alert icon
- **Warning** - Yellow with warning icon
- **Info** - Blue with info icon

### 4. Integration in Components

Each component using error handling:

1. Import `useError` hook and `ErrorHandler`
2. Call `addError()` when exceptions occur
3. Errors automatically display as toasts
4. Context provides error history for debugging

**Example:**
```typescript
import { useError } from "../contexts/ErrorContext";
import { ErrorHandler } from "../utils/errorHandler";

const InteractiveLoginFlow = () => {
  const { addError } = useError();

  const handleLogin = async () => {
    try {
      // ... login logic
    } catch (err) {
      // Log error with context and display to user
      addError(err, "InteractiveLoginFlow.handleLogin");
    }
  };
};
```

## Error Flow

```
Error occurs
    ↓
ErrorHandler.handle() - Classify error
    ↓
AppError object created with:
  - Code (error type)
  - Message (technical details)
  - User-friendly message
  - Severity level
  - Details/context
    ↓
Component calls addError()
    ↓
ErrorContext stores error
    ↓
ErrorToastContainer renders toast
    ↓
Toast displayed in UI (top-right)
    ↓
Auto-dismiss after 8s (non-critical)
    OR
Manual dismiss via X button
```

## Severity Levels

### Critical
- Red alert with icon
- Stays until manually dismissed
- Indicates serious operational failure

### Error
- Red alert with icon
- Stays until manually dismissed
- Indicates failed operation

### Warning
- Yellow alert with icon
- Auto-dismisses after 8 seconds
- Indicates issue but operation may continue

### Info
- Blue alert with icon
- Auto-dismisses after 8 seconds
- Informational message

## Component Changes

### App.tsx
- Wrapped with `ErrorProvider`
- Includes `ErrorToastContainer` in render
- `AppContent` component uses `useError` hook

### InteractiveLoginFlow.tsx
- Uses `useError` hook
- Calls `addError()` for validation errors
- Calls `addError()` from IPC error events
- Provides context for error logging

## Best Practices

1. **Always provide context** when calling `addError()`:
   ```typescript
   addError(err, "ComponentName.methodName");
   ```

2. **Validate early** and use `VALIDATION_ERROR`:
   ```typescript
   const error = ErrorHandler.createError(
     "VALIDATION_ERROR",
     "Field is required",
     { field: "name" }
   );
   addError(error, "MyComponent");
   ```

3. **Catch at operation boundaries**:
   - API calls
   - File operations
   - User interactions

4. **Let auto-dismiss work** for warnings and info
   - Only create critical errors when truly critical
   - Users can manually dismiss if needed

5. **Provide error context** for debugging:
   ```typescript
   addError(err, "ProfileUpload.handleCompress");
   ```

## Console Logging

Errors are logged to browser console with:
- Severity level
- Component/method context
- Original error message
- Error details object

Format:
```
[ERROR] [ComponentName] original error message { details... }
[WARNING] [ComponentName] warning message { details... }
```

## Testing Error Handling

To test error display:

1. Trigger validation error:
   - Leave Vinted email empty and click "Start"
   - Red toast appears with validation message

2. Trigger network error:
   - Disconnect internet during login
   - Network error toast appears

3. Trigger session error:
   - Session-related operations fail
   - Appropriate error message displayed

## Future Enhancements

- [ ] Error retry mechanisms
- [ ] Error analytics/tracking
- [ ] Error boundaries (React Error Boundary)
- [ ] Persistent error log
- [ ] User feedback form for errors
- [ ] Error recovery suggestions
