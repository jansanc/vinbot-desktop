// In-memory storage for sessions (used in dev when localStorage is unavailable)
const memoryStore = new Map<string, string>();

/**
 * API base URL, resolved for BOTH processes.
 *
 * CRA inlines REACT_APP_* only into the renderer bundle, and a packaged app
 * never loads .env in the main process — so main used to fall back to
 * localhost:3001 in production and every request from there failed. Now that
 * the main process issues all API calls, the fallback must be the production
 * API. Dev overrides it through .env (dev-start.js loads dotenv and passes the
 * environment to the Electron child), and VINBOT_API_URL is available as a
 * main-process-only override.
 */
const PRODUCTION_API_URL = "https://api.vinbot.app";

const resolvedBaseUrl =
  process.env.REACT_APP_API_URL || process.env.VINBOT_API_URL || PRODUCTION_API_URL;

/**
 * Cloudflare Turnstile site key: the same public key the web app is built with
 * (NEXT_PUBLIC_TURNSTILE_SITE_KEY in vinted-api). The API asks for a token on
 * login once it has TURNSTILE_SECRET_KEY; empty here means the app sends none.
 * Like the API URL, a packaged build reads no .env, so production needs it here.
 */
const PRODUCTION_TURNSTILE_SITE_KEY = "";

export const config = {
  api: {
    baseUrl: resolvedBaseUrl,
    endpoints: {
      auth: {
        login: "/api/v1/auth/login",
        logout: "/api/v1/auth/logout",
        refresh: "/api/v1/auth/refresh",
        me: "/api/v1/auth/me",
      },
      vinted: {
        link: "/api/v1/vinted/auth/link",
        profileUpload: "/api/v1/vinted/auth/profile-upload",
        profileDownload: "/api/v1/integrations/vinted/profile/download",
      },
    },
  },
  turnstile: {
    siteKey: process.env.VINBOT_TURNSTILE_SITE_KEY ?? PRODUCTION_TURNSTILE_SITE_KEY,
    // Where the check page appears to live (see src/main/turnstile.ts). Its
    // hostname must be one the site key allows in the Cloudflare dashboard.
    pageUrl:
      process.env.VINBOT_TURNSTILE_PAGE_URL || "https://app.vinbot.app/desktop-turnstile",
  },
  vinted: {
    baseUrl:
      process.env.REACT_APP_VINTED_BASE_URL || "https://www.vinted.es",
  },
  storage: {
    keys: {
      session: "vinted_session",
      user: "vinted_user",
    },
    // In-memory storage adapter for development/testing
    memoryStore,
  },
  app: {
    name: "Vinbot Authenticator",
    version: "1.0.0",
  },
};
