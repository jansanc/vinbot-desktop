// In-memory storage for sessions (used in dev when localStorage is unavailable)
const memoryStore = new Map<string, string>();

export const config = {
  api: {
    baseUrl: process.env.REACT_APP_API_URL || "http://localhost:3001",
    endpoints: {
      auth: {
        login: "/api/v1/auth/login",
        logout: "/api/v1/auth/logout",
        refresh: "/api/v1/auth/refresh",
        me: "/api/v1/auth/me",
      },
      vinted: {
        desktopSession: "/api/v1/vinted/auth/desktop-session",
      },
    },
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
    name: "Vinted Desktop Authenticator",
    version: "1.0.0",
  },
};
