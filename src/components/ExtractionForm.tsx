import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Globe,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";

type BrowserType = "chrome" | "firefox" | "edge";

interface ExtractionFormProps {
  onSubmit: (data: {
    browser: BrowserType;
    profile?: string;
    vintedEmail: string;
    userEmail: string;
    vintedMemberId: string;
    vintedBaseUrl: string;
  }) => Promise<void>;
  firefoxProfiles: string[];
  chromeProfiles: string[];
  edgeProfiles: string[];
  loadingProfiles: boolean;
}

const browserConfig: Record<BrowserType, { name: string; dot: string }> = {
  chrome: { name: "Chrome", dot: "bg-[oklch(0.7_0.18_145)]" },
  firefox: { name: "Firefox", dot: "bg-[oklch(0.68_0.2_45)]" },
  edge: { name: "Edge", dot: "bg-[oklch(0.62_0.15_220)]" },
};

const browserOrder: BrowserType[] = ["chrome", "firefox", "edge"];

export default function ExtractionForm({
  onSubmit,
  firefoxProfiles,
  chromeProfiles,
  edgeProfiles,
  loadingProfiles,
}: ExtractionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [selectedBrowser, setSelectedBrowser] = useState<BrowserType>("chrome");
  const [selectedProfile, setSelectedProfile] = useState("");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (selectedBrowser === "firefox" && !selectedProfile) {
        throw new Error("Please select a Firefox profile to continue.");
      }

      await onSubmit({
        browser: selectedBrowser,
        profile: selectedBrowser === "firefox" ? selectedProfile : undefined,
        vintedEmail: "",
        userEmail: "",
        vintedMemberId: "",
        vintedBaseUrl: "https://www.vinted.es",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldClasses =
    "w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25 focus:outline-none";

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <header className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20">
            <Lock size={26} aria-hidden="true" />
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Vinted Session Extractor
          </h1>
          <p className="mt-3 max-w-md text-pretty leading-relaxed text-muted-foreground">
            Securely extract cookie session data from the browser you choose of
            your Vinted account. This data is encrypted and will be uploaded to
            Vinbot servers in order to automatically authenticate your account.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          {/* Browser selection */}
          <section className="border-b border-border p-6 sm:p-8">
            <div className="mb-4 flex items-center gap-2.5">
              <Globe size={18} className="text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Browser
              </h2>
            </div>
            <div
              role="radiogroup"
              aria-label="Select a browser"
              className="grid grid-cols-3 gap-3"
            >
              {browserOrder.map((browser) => {
                const isSelected = selectedBrowser === browser;
                return (
                  <button
                    key={browser}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      setSelectedBrowser(browser);
                      setSelectedProfile("");
                    }}
                    className={`relative flex flex-col items-center gap-2.5 rounded-xl border-2 px-4 py-5 text-sm font-medium transition-all ${
                      isSelected
                        ? "border-primary bg-accent text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-ring/40 hover:bg-muted/60"
                    }`}
                  >
                    <span
                      className={`size-3 rounded-full ${browserConfig[browser].dot}`}
                      aria-hidden="true"
                    />
                    {browserConfig[browser].name}
                    {isSelected && (
                      <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check size={12} strokeWidth={3} aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Browser profile selection */}
            {(selectedBrowser === "firefox" || selectedBrowser === "chrome" || selectedBrowser === "edge") && (
              <div className="mt-5">
                <label
                  htmlFor="browser-profile"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  {selectedBrowser.charAt(0).toUpperCase() + selectedBrowser.slice(1)} Profile{" "}
                  {selectedBrowser === "firefox" && <span className="text-destructive">*</span>}
                </label>
                {loadingProfiles ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    <Loader2
                      size={16}
                      className="animate-spin text-primary"
                      aria-hidden="true"
                    />
                    Loading profiles...
                  </div>
                ) : (() => {
                  const profiles =
                    selectedBrowser === "firefox"
                      ? firefoxProfiles
                      : selectedBrowser === "chrome"
                        ? chromeProfiles
                        : edgeProfiles;

                  return profiles.length > 0 ? (
                    <div className="relative">
                      <select
                        id="browser-profile"
                        value={selectedProfile}
                        onChange={(e) => setSelectedProfile(e.target.value)}
                        className={`${fieldClasses} appearance-none pr-10`}
                      >
                        <option value="">
                          {selectedBrowser === "firefox" ? "Select a profile..." : "Select a profile (Default will be used if empty)..."}
                        </option>
                        {profiles.map((profile) => (
                          <option key={profile} value={profile}>
                            {profile}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={18}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 rounded-lg border border-[oklch(0.85_0.1_85)] bg-[oklch(0.97_0.04_85)] px-4 py-3">
                      <AlertCircle
                        size={18}
                        className="mt-0.5 shrink-0 text-[oklch(0.55_0.13_70)]"
                        aria-hidden="true"
                      />
                      <p className="text-sm text-[oklch(0.4_0.09_70)]">
                        No {selectedBrowser} profiles found. Please ensure{" "}
                        {selectedBrowser === "firefox"
                          ? "Firefox"
                          : selectedBrowser === "chrome"
                            ? "Chrome"
                            : "Edge"}{" "}
                        is installed.
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>

          {/* Account details */}
          <section className="p-6 sm:p-8">
            <div className="mb-5 flex items-center gap-2.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Account Details
              </h2>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
              >
                <AlertCircle
                  size={18}
                  className="mt-0.5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || loadingProfiles}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2
                    size={18}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  Extracting...
                </>
              ) : (
                <>
                  <Lock size={18} aria-hidden="true" />
                  Extract &amp; Secure
                </>
              )}
            </button>
          </section>
        </form>

        {/* Security notice */}
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/20 bg-accent px-5 py-4">
          <ShieldCheck
            size={18}
            className="mt-0.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold text-accent-foreground">
              Your data stays secure
            </p>
            <p className="mt-1 text-sm leading-relaxed text-accent-foreground/80">
              All extraction happens locally on your device. Data is encrypted
              and never transmitted without explicit consent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
