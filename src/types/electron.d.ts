declare global {
  interface Window {
    electronAPI: {
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
