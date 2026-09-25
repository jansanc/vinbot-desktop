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
        storeDesktopSession: (payload: {
          accessToken?: string;
          vintedEmail: string;
          browserFingerprint: Record<string, any>;
          sessionData: Array<Record<string, any>>;
          sessionOrigins: Array<Record<string, any>>;
          vintedMemberId?: string;
          updateSessionOnly?: boolean;
        }) => Promise<IpcResult<any>>;
        getStoredSession: () => Promise<
          IpcResult<{ hasSession: boolean; expiresAt: number; expiresIn: number } | null>
        >;
        onSessionRefreshed?: (
          callback: (session: {
            accessToken: string;
            refreshToken: string;
            expiresIn: number;
            expiresAt: number;
          }) => void
        ) => () => void;
        onUnauthorized?: (callback: (detail: { message: string }) => void) => () => void;
      };
      extractVintedSession: (options: {
        firefoxProfile: string;
        vintedBaseUrl: string;
      }) => Promise<any>;
      saveExtraction: (
        data: any,
        saveMethod: "database" | "file" | "both",
        options: any,
      ) => Promise<any>;
      selectDirectory: () => Promise<string | null>;
      onExtractionProgress: (callback: (data: any) => void) => void;
      removeProgressListener: () => void;
      getFirefoxProfiles: () => Promise<any[]>;
      getChromeProfiles: () => Promise<any[]>;
      getEdgeProfiles: () => Promise<any[]>;
      validateVintedCredentials: (
        email: string,
        memberId: string,
      ) => Promise<any>;
      openExternalLink: (url: string) => Promise<void>;
      openBrowserWithProfile: (browser: string, profile: string) => Promise<any>;
      // Profile upload handlers
      uploadProfile: (options: {
        browser: "chrome" | "firefox" | "edge";
        profileId: string;
        profileName: string;
        profilePath: string;
        accessToken: string;
        vintedAccountId: string;
        userId: string;
      }) => Promise<any>;
      batchUploadProfiles: (options: {
        profiles: Array<{
          id: string;
          name: string;
          path: string;
          browser: "chrome" | "firefox" | "edge";
        }>;
        accessToken: string;
        vintedAccountId: string;
        userId: string;
      }) => Promise<any>;
      onBatchUploadProgress: (callback: (data: any) => void) => void;
    };
  }
}

export {};
