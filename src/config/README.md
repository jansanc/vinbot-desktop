# Configuration Management

All application configuration is centralized in this folder for easy management and consistency across the codebase.

## Structure

### `config.ts`
Main configuration file that loads settings from environment variables with sensible defaults.

```typescript
config.api         // API configuration
├── baseUrl        // Backend API base URL
└── endpoints      // API endpoint paths
    ├── auth       // Authentication endpoints
    └── vinted     // Vinted-specific endpoints

config.vinted      // Vinted-specific settings
├── baseUrl        // Vinted website base URL

config.storage     // Browser storage configuration
├── keys           // localStorage key names

config.app         // Application metadata
├── name           // App display name
└── version        // App version
```

## Environment Variables

All configuration is driven by environment variables in `.env`:

### API Configuration
- `REACT_APP_API_URL` — Backend API base URL (default: `http://localhost:3000`)

### Vinted Configuration
- `REACT_APP_VINTED_BASE_URL` — Vinted website URL (default: `https://www.vinted.es`)

### Application Configuration
- `REACT_APP_NAME` — Application display name (default: `Vinbot Authenticator`)

## Usage

### In Components/Services
```typescript
import { config } from "../config/config";

// Use API base URL
const apiUrl = config.api.baseUrl;

// Use endpoints
const loginUrl = `${config.api.baseUrl}${config.api.endpoints.auth.login}`;

// Use Vinted base URL
const vintedUrl = config.vinted.baseUrl;

// Use storage keys
const sessionKey = config.storage.keys.session;
```

## In-Memory Storage

The app includes a fallback in-memory storage adapter (`storage.ts`) that automatically kicks in when `localStorage` is unavailable. This is useful for:

- **Development** — Electron environments where localStorage may be restricted
- **Testing** — Isolated memory store without side effects
- **Graceful degradation** — App continues to work even if storage fails

### Using Storage Adapter

```typescript
import { storage } from "../config/storage";

// Use storage adapter instead of localStorage
storage.setItem("key", value);
storage.getItem("key");
storage.removeItem("key");
storage.clear();
```

The adapter automatically:
1. Tries `localStorage` first
2. Falls back to in-memory store if unavailable
3. Logs warnings when falling back
4. Returns same interface as `localStorage`

## Benefits

1. **Centralized** — All configuration in one place
2. **Environment-aware** — Different values for dev/staging/production
3. **Type-safe** — TypeScript ensures correct usage
4. **DRY** — No hardcoded values scattered across the codebase
5. **Easy to maintain** — Update `.env` without changing code
6. **Resilient** — In-memory fallback for restricted environments
