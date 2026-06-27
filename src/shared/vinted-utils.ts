export function getVintedHostname(vintedBaseUrl: string): string {
  try {
    const url = new URL(vintedBaseUrl);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "vinted.com";
  }
}

export function normalizeCookieDomain(domain: string): string {
  let normalized = domain.toLowerCase().trim();
  if (normalized.startsWith(".www.")) {
    normalized = normalized.replace(/^\.www\./, ".");
  } else if (normalized === "www.vinted.es") {
    normalized = ".vinted.es";
  }
  return normalized;
}

export function isAuthRelatedStorage(key: string): boolean {
  if (key.match(/^[a-f0-9]{64,}$/) !== null) {
    return false;
  }
  const authKeywords = [
    "session",
    "token",
    "auth",
    "user",
    "refresh",
    "access",
  ];
  return authKeywords.some((k) => key.toLowerCase().includes(k));
}

export function convertValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value as Record<string, unknown>);
    const allNumeric =
      keys.length > 0 && keys.every((k) => !isNaN(parseInt(k)));
    if (allNumeric) {
      const charCodes = keys
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((key) => (value as Record<string, number>)[key]);
      try {
        return String.fromCharCode(...charCodes);
      } catch {
        return JSON.stringify(value);
      }
    }
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
