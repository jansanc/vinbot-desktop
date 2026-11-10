type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { name: string; message: string; code?: string; status?: number } };

declare global {
  /** Mirrors UpdateStatus in src/main/updater.ts */
  type UpdateStatus =
    | { state: "idle" }
    | { state: "downloading"; version: string; percent: number }
    | { state: "ready"; version: string };

  /** Mirrors LoginResponse in src/main/session/login.handlers.ts */
  type InteractiveLoginResponse = {
    success: boolean;
    message: string;
    code?:
      | "LOGIN_TIMEOUT"
      | "LOGIN_CANCELLED"
      | "FIREFOX_NOT_FOUND"
      | "FIREFOX_FAILED"
      | "NOT_LOGGED_IN"
      | "SESSION_EXPIRED"
      | "LOGIN_IN_PROGRESS"
      | "ACCOUNT_MISMATCH";
    /** The Vinted member logged in to (see src/main/session/account-match.ts) */
    vintedMemberId?: string;
    /** ACCOUNT_MISMATCH: the email that member is already linked under */
    linkedAs?: string;
  };

  /** Mirrors the vinted:accounts result (src/main/api/auth.handlers.ts) */
  type VintedAccountSummary = {
    id: string;
    vintedEmail: string;
    lastLoginAt: string | null;
    isPrimary: boolean;
    isDisabled: boolean;
    sessionStatus: "healthy" | "unhealthy" | "unknown" | "not_connected";
  };

  interface Window {
    electronAPI: {
      // API calls proxied through the main process to bypass CORS.
      auth: {
        login: (credentials: {
          email: string;
          password: string;
        }) => Promise<IpcResult<any>>;
        providers: () => Promise<IpcResult<{ google?: boolean }>>;
        resendVerification: (email: string) => Promise<IpcResult<void>>;
        // null: the user cancelled
        googleLogin: (locale?: string) => Promise<IpcResult<any | null>>;
        cancelGoogleLogin: () => Promise<IpcResult<void>>;
        me:(accessToken?: string) => Promise<IpcResult<any>>;
        refresh: (refreshToken?: string) => Promise<IpcResult<any>>;
        logout: (accessToken?: string) => Promise<IpcResult<{ success: boolean }>>;
        getStoredSession: () => Promise<
          IpcResult<{ hasSession: boolean; expiresAt: number; expiresIn: number } | null>
        >;
        onSessionRefreshed?: (
          // Expiry only: main never sends the tokens to the renderer.
          callback: (session: { expiresIn: number; expiresAt: number }) => void
        ) => () => void;
        onUnauthorized?: (callback: (detail: { message: string }) => void) => () => void;
      };
      updater?: {
        getStatus: () => Promise<UpdateStatus>;
        install: () => Promise<{ ok: true } | { ok: false; reason: "not-ready" | "busy" }>;
        onStatus: (callback: (status: UpdateStatus) => void) => () => void;
      };
      // The Vinted login window (src/main/session/login.handlers.ts)
      interactiveLogin: (options: {
        userEmail: string;
        vintedEmail: string;
        vintedMemberId?: string;
        /** The app's language (a Locale); sets Firefox's Accept-Language. */
        locale?: string;
        /** Emails linked from this computer and their Vinted member, to catch a wrong-account login */
        knownAccounts?: Array<{ email: string; memberId: string }>;
      }) => Promise<InteractiveLoginResponse>;
      cancelInteractiveLogin: () => Promise<{ ok: true }>;
      /** Save the login held back by ACCOUNT_MISMATCH */
      confirmPendingLogin: () => Promise<InteractiveLoginResponse>;
      discardPendingLogin: () => Promise<{ ok: true }>;
      vintedAccounts: () => Promise<IpcResult<VintedAccountSummary[]>>;
      onInteractiveLoginProgress: (
        callback: (data: { step: string; message: string; timestamp: string }) => void
      ) => () => void;
    };
  }
}

export {};
