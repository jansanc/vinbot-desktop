import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Globe,
  Loader2,
  Lock,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { config } from "../config/config";
import { ProfileInfo } from "../types";

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
  firefoxProfiles: ProfileInfo[];
  chromeProfiles: ProfileInfo[];
  edgeProfiles: ProfileInfo[];
  loadingProfiles: boolean;
}

const browserConfig: Record<BrowserType, { name: string; dot: string }> = {
  chrome: { name: "Chrome", dot: "bg-[oklch(0.7_0.18_145)]" },
  firefox: { name: "Firefox", dot: "bg-[oklch(0.68_0.2_45)]" },
  edge: { name: "Edge", dot: "bg-[oklch(0.62_0.15_220)]" },
};

const browserOrder: BrowserType[] = ["firefox", "chrome", "edge"];

export default function ExtractionForm({
  onSubmit,
  firefoxProfiles,
  chromeProfiles,
  edgeProfiles,
  loadingProfiles,
}: ExtractionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [selectedBrowser, setSelectedBrowser] = useState<BrowserType>("firefox");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [vintedEmail, setVintedEmail] = useState("");
  const [isOpeningBrowser, setIsOpeningBrowser] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (!selectedProfile) {
        throw new Error("Please select a browser profile to continue.");
      }

      await onSubmit({
        browser: selectedBrowser,
        profile: selectedProfile,
        vintedEmail,
        userEmail: "",
        vintedMemberId: "",
        vintedBaseUrl: config.vinted.baseUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenBrowser = async () => {
    try {
      setIsOpeningBrowser(true);
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        throw new Error("Electron API not available");
      }

      const profile =
        selectedBrowser === "firefox"
          ? selectedProfile
          : selectedBrowser === "chrome"
            ? selectedProfile || "Default"
            : selectedProfile || "Default";

      await electronAPI.openBrowserWithProfile(selectedBrowser, profile);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to open browser"
      );
    } finally {
      setIsOpeningBrowser(false);
    }
  };

  const fieldClasses =
    "w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25 focus:outline-none";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12 sm:py-16">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 bg-background" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: `
            linear-gradient(to right, oklch(1 0 0) 1px, transparent 1px),
            linear-gradient(to bottom, oklch(1 0 0) 1px, transparent 1px)
          `,
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)",
        }}
      />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full opacity-30 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, oklch(0.62 0.15 277 / 0.5), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-xl">
        {/* Header */}
        <header className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
            <Lock size={20} className="text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
            Extract Session
          </h1>
          <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
            Select a browser to extract your Vinted session. All processing
            happens locally on your device and is encrypted before transmission.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-[0_1px_0_0_oklch(1_0_0/0.04)_inset,0_24px_48px_-12px_oklch(0_0_0/0.5)] backdrop-blur-xl"
        >
          {/* Browser selection */}
          <section className="border-b border-border px-6 py-7 sm:px-8">
            <div className="mb-5 flex items-center gap-2.5">
              <Globe
                size={16}
                className="text-muted-foreground"
                aria-hidden="true"
              />
              <h2 className="text-sm font-medium tracking-tight text-foreground">
                Select browser
              </h2>
            </div>
            <div
              role="radiogroup"
              aria-label="Select a browser"
              className="grid grid-cols-3 gap-2.5"
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
                    className={`relative flex flex-col items-center gap-2.5 rounded-xl border px-4 py-4 text-sm font-medium transition-all duration-200 ${
                      isSelected
                        ? "border-primary/60 bg-primary/10 text-foreground shadow-[0_0_0_1px_oklch(0.62_0.15_277/0.4)]"
                        : "border-border bg-secondary/30 text-muted-foreground hover:border-border hover:bg-secondary/60 hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`size-2.5 rounded-full ${browserConfig[browser].dot}`}
                      aria-hidden="true"
                    />
                    {browserConfig[browser].name}
                    {isSelected && (
                      <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check size={10} strokeWidth={3} aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Browser profile selection */}
            {(selectedBrowser === "firefox" ||
              selectedBrowser === "chrome" ||
              selectedBrowser === "edge") && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="browser-profile"
                    className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {selectedBrowser.charAt(0).toUpperCase() +
                      selectedBrowser.slice(1)}{" "}
                    Profile{" "}
                    <span className="text-destructive">*</span>
                  </label>
                  {selectedProfile && (
                    <button
                      type="button"
                      onClick={handleOpenBrowser}
                      disabled={isOpeningBrowser}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isOpeningBrowser ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Opening...
                        </>
                      ) : (
                        <>
                          <ExternalLink size={12} />
                          Open Profile
                        </>
                      )}
                    </button>
                  )}
                </div>
                {loadingProfiles ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                    <Loader2
                      size={15}
                      className="animate-spin text-primary"
                      aria-hidden="true"
                    />
                    Loading profiles...
                  </div>
                ) : (
                  (() => {
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
                            Select a profile...
                          </option>
                          {profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={16}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 rounded-lg border border-[oklch(0.55_0.13_70/0.4)] bg-[oklch(0.55_0.13_70/0.12)] px-4 py-3">
                        <AlertCircle
                          size={16}
                          className="mt-0.5 shrink-0 text-[oklch(0.78_0.13_75)]"
                          aria-hidden="true"
                        />
                        <p className="text-sm text-[oklch(0.85_0.08_75)]">
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
                  })()
                )}
              </div>
            )}
          </section>

          {/* Account details */}
          <section className="px-6 py-7 sm:px-8">
            <h2 className="text-sm font-medium tracking-tight text-foreground">
              Extract &amp; authenticate
            </h2>

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
              >
                <AlertCircle
                  size={16}
                  className="mt-0.5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-destructive">{error}</p>
              </div>
            )}

            <div className="mt-6">
              <label
                htmlFor="vinted-email"
                className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Vinted Email <span className="text-destructive">*</span>
              </label>
              <input
                id="vinted-email"
                type="email"
                value={vintedEmail}
                onChange={(e) => setVintedEmail(e.target.value)}
                placeholder="your.email@example.com"
                className={fieldClasses}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || loadingProfiles}
              className="group relative mt-6 flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2
                    size={15}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  Extracting session...
                </>
              ) : (
                <>
                  <Lock size={15} aria-hidden="true" />
                  Extract &amp; Authenticate
                </>
              )}
            </button>
          </section>
        </form>

        {/* Security notice */}
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-card/50 px-4 py-3.5">
          <ShieldCheck
            size={16}
            className="mt-0.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              Security &amp; privacy
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Session extraction occurs locally on your device. Data is
              encrypted using industry-standard protocols before any
              transmission.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
