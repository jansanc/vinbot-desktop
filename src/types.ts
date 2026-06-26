export type ExtractionState =
  | "idle"
  | "extracting"
  | "saving"
  | "complete"
  | "error";

export interface Fingerprint {
  extractedAt: string;
  browser: string;
  source: string;
  userAgent: string;
  language: string;
  languages: string[];
  platform: string;
  timezone: string;
  locale: string;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
  };
  hardwareConcurrency: number;
  deviceMemory: number;
  installedFonts: string[];
  plugins: Array<{ name: string; description: string }>;
  systemInfo: {
    platform: string;
    arch: string;
    firefoxVersion: string;
  };
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface LocalStorageItem {
  name: string;
  value: string;
}

export interface StorageOrigin {
  origin: string;
  localStorage?: LocalStorageItem[];
  sessionStorage?: LocalStorageItem[];
}

export interface ExtractionData {
  fingerprint: Fingerprint;
  authentication: {
    cookies: Cookie[];
    origins: StorageOrigin[];
  };
}

export interface ExtractionProgress {
  stage:
    | "fingerprint"
    | "cookies"
    | "localStorage"
    | "sessionStorage"
    | "complete";
  message: string;
  progress: number;
}
