type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { name: string; message: string } };

declare global {
  interface Window {
    electronAPI: {
      // API calls proxied through the main process to bypass CORS.
      auth: {
        login: (credentials: {
          email: string;
          password: string;
        }) => Promise<IpcResult<any>>;
        me: (accessToken?: string) => Promise<IpcResult<any>>;
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
