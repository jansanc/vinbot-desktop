# API Configuration Reference

## Environment Variables

### Required Configuration

```env
# .env file (Desktop Authenticator)

# ============================================
# API Configuration
# ============================================
# Backend API base URL (vinted-api server)
# Default: http://localhost:3001 (development)
REACT_APP_API_URL=http://localhost:3001

# ============================================
# Vinted Configuration
# ============================================
# Vinted website base URL (choose region)
REACT_APP_VINTED_BASE_URL=https://www.vinted.es

# ============================================
# App Configuration
# ============================================
# Application display name
REACT_APP_NAME=Vinbot Authenticator
```

### Optional Configuration

```env
# API timeout in milliseconds (default: 30000)
REACT_APP_API_TIMEOUT=30000

# Enable debug logging (true/false)
REACT_APP_DEBUG=false
```

## API Endpoints

All endpoints defined in `src/config/config.ts`:

### Authentication Endpoints (API v1)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/auth/login` | POST | User login |
| `/api/v1/auth/logout` | POST | User logout |
| `/api/v1/auth/refresh` | POST | Refresh auth token |
| `/api/v1/auth/me` | GET | Get current user |

### Vinted Integration Endpoints (API v1)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/vinted/auth/desktop-session` | POST | Store desktop session (legacy) |

### Session & Profile Endpoints (API v2)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/integrations/vinted/session/upload` | POST | Upload browser session (cookies) |
| `/api/v2/integrations/vinted/profile/upload` | POST | Upload complete browser profile |
| `/api/v2/integrations/vinted/profile/download/{id}` | GET | Download stored profile |

## Configuration Usage in Code

### Access API Base URL

```typescript
import { config } from "../config/config";

const baseUrl = config.api.baseUrl;
// http://localhost:3001
```

### Access Endpoints

```typescript
import { config } from "../config/config";

// Auth endpoints
const loginEndpoint = `${config.api.baseUrl}${config.api.endpoints.auth.login}`;
// http://localhost:3001/api/v1/auth/login

// Session endpoint
const sessionEndpoint = `${config.api.baseUrl}${config.api.endpoints.vinted.sessionUpload}`;
// http://localhost:3001/api/v2/integrations/vinted/session/upload

// Profile endpoint
const profileEndpoint = `${config.api.baseUrl}${config.api.endpoints.vinted.profileUpload}`;
// http://localhost:3001/api/v2/integrations/vinted/profile/upload
```

### API Service Usage

```typescript
import { ApiService } from "./services/api.service";

// Login
const response = await ApiService.login({
  email: "user@app.com",
  password: "password"
});

// Store desktop session
const sessionResult = await ApiService.storeDesktopSession(
  accessToken,
  {
    vintedEmail: "user@vinted.com",
    browserFingerprint: { ... },
    sessionData: [ ... ],
    sessionOrigins: [ ... ],
    vintedMemberId: "12345",
  }
);
```

## Running the Services

### Start Vinted API (Port 3001)

```bash
cd vinted-api/integrations

# Development
python -m uvicorn vinted_bot.api.server:app --host 127.0.0.1 --port 3001 --reload

# OR using launch script
python launch.py
```

### Start Desktop Authenticator

```bash
cd vinbot-desktop-authenticator

# Development with live reload
npm start

# Build for production
npm run electron-build
```

## Verifying Connection

### Health Check

```bash
# Check if API is running
curl http://localhost:3001/api/v2/integrations/vinted/health

# Expected response:
# {
#   "status": "success",
#   "message": "API is healthy and ready",
#   "data": {"browser": "initialized"}
# }
```

### Test Endpoints (from browser console)

```javascript
// Test API connection
fetch('http://localhost:3001/api/v2/integrations/vinted/health')
  .then(r => r.json())
  .then(data => console.log('API Status:', data));

// Test session upload
fetch('http://localhost:3001/api/v2/integrations/vinted/session/upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    vintedEmail: 'test@vinted.com',
    userEmail: 'user@app.com',
    session: {
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      profile_name: 'Test',
      extracted_at: Date.now()
    }
  })
})
.then(r => r.json())
.then(data => console.log('Response:', data));
```

## Environment-Specific Configuration

### Development

```env
REACT_APP_API_URL=http://localhost:3001
REACT_APP_VINTED_BASE_URL=https://www.vinted.es
REACT_APP_DEBUG=true
```

### Staging

```env
REACT_APP_API_URL=https://staging-api.yourdomain.com
REACT_APP_VINTED_BASE_URL=https://www.vinted.es
REACT_APP_DEBUG=false
```

### Production

```env
REACT_APP_API_URL=https://api.yourdomain.com
REACT_APP_VINTED_BASE_URL=https://www.vinted.es
REACT_APP_DEBUG=false
REACT_APP_API_TIMEOUT=60000
```

## API Response Format

All API responses follow a standard format:

### Success Response

```json
{
    "status": "success",
    "message": "Operation successful",
    "data": {
        "key": "value"
    },
    "requestId": "req-123"
}
```

### Error Response

```json
{
    "status": "fail",
    "message": "Error message",
    "data": null,
    "requestId": "req-123"
}
```

## CORS Configuration

The API server has CORS enabled for:
- `http://localhost:3001`
- `http://127.0.0.1:3001`
- `http://localhost:5173` (React dev server)
- `http://127.0.0.1:5173`

For production, update `vinted-api/integrations/vinted_bot/api/server.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://yourdomain.com",
        "https://app.yourdomain.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Troubleshooting

### "Cannot reach API" Error

1. **Check API is running**:
   ```bash
   curl http://localhost:3001/api/v2/integrations/vinted/health
   ```

2. **Check environment variable**:
   ```bash
   # In browser console
   console.log(config.api.baseUrl)
   ```

3. **Check .env file**:
   ```bash
   cat .env | grep REACT_APP_API_URL
   ```

4. **Check port 3001 is available**:
   ```bash
   # Windows
   netstat -ano | findstr :3001
   
   # macOS/Linux
   lsof -i :3001
   ```

### "CORS Error"

- Ensure API has CORS middleware enabled
- Check `allow_origins` in API config
- Verify `REACT_APP_API_URL` matches allowed origin

### "401 Unauthorized"

- Verify access token is valid
- Check token is included in Authorization header
- Token may have expired (refresh needed)

### "Network Timeout"

- Increase `REACT_APP_API_TIMEOUT`
- Check internet connection
- Verify API server is responsive
- Check for firewall/proxy blocking

## Security Notes

✅ **HTTPS in Production**: Always use HTTPS for production deployments

✅ **API Keys**: If using API keys, store in environment variables only

✅ **Token Storage**: Auth tokens stored in localStorage (consider secure alternatives)

✅ **CORS**: Configure CORS appropriately for your domains

✅ **Rate Limiting**: Consider adding rate limiting to API

## API Documentation

For complete API documentation, see:
- `vinted-api/integrations/docs/` - API documentation
- `vinted-api/integrations/README.md` - Setup instructions
- `vinted-api/integrations/INTEGRATION_SUMMARY.md` - Integration guide

## Configuration Files

| File | Purpose |
|------|---------|
| `.env` | Environment variables (git-ignored) |
| `.env.example` | Template for .env |
| `src/config/config.ts` | TypeScript config object |
| `vinted-api/integrations/vinted_bot/api/server.py` | API CORS config |

## Next Steps

1. ✅ Configure `.env` with API URL
2. ✅ Start vinted-api server on port 3001
3. ✅ Start desktop app with `npm start`
4. ✅ Verify connection with health check
5. ✅ Test endpoints from browser console
6. ✅ Deploy to production with appropriate URLs
