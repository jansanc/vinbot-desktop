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
      getFirefoxProfiles: () => Promise<string[]>;
      validateVintedCredentials: (
        email: string,
        memberId: string,
      ) => Promise<any>;
      openExternalLink: (url: string) => Promise<void>;
    };
  }
}

export {};
