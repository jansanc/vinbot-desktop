type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { name: string; message: string; code?: string; status?: number } };

declare global {
  /** Mirrors UpdateStatus in src/main/updater.ts */
  type UpdateStatus =
    | { state: "idle" }
    | { state: "downloading"; version: string; percent: number }
    | { state: "ready"; version: string };

  interface Window {
    electronAPI: {
      // API calls proxied through the main process to bypass CORS.
      auth: {
        login: (credentials: {
          email: string;
          password: string;
        }) => Promise<IpcResult<any>>;
        providers: () => Promise<IpcResult<{ google?: boolean }>>;
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
      // Typed loosely; the flows call these through (window as any).
      interactiveLogin: (options: Record<string, unknown>) => Promise<any>;
      findFirefoxSessions: () => Promise<any>;
      importFirefoxSession: (options: Record<string, unknown>) => Promise<any>;
      onInteractiveLoginProgress: (callback: (data: any) => void) => unknown;
      offInteractiveLoginProgress: (listener: unknown) => void;
      onInteractiveLoginError: (callback: (data: any) => void) => unknown;
      offInteractiveLoginError: (listener: unknown) => void;
    };
  }
}

export {};
