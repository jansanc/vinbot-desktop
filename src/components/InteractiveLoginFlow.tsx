import React, { useState, useEffect, useCallback, useRef } from "react";
import { AlertCircle, CheckCircle2, Loader2, ChevronDown, LogIn, Import, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import { useError } from "../contexts/ErrorContext";
import { ErrorHandler } from "../utils/errorHandler";

interface LoginProgress {
  step: string;
  message: string;
  timestamp: string;
}

/** A Firefox profile and its Vinted session, from vinted:findFirefoxSessions. */
interface FirefoxProfileSession {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  session: {
    state: "logged-in" | "anonymous" | "none";
    /** One per Vinted site logged in to; each is a separate account. */
    sites: Array<{ site: string; userId?: string; expiresAt?: number }>;
    cookieCount: number;
  };
  error?: string;
}

/** One importable session: a Firefox profile and one Vinted site it's logged in to. */
interface ImportChoice {
  key: string;
  profile: FirefoxProfileSession;
  site?: { site: string; userId?: string; expiresAt?: number };
}

/** A row per logged-in site, or one disabled row for a profile with none. */
function importChoices(profiles: FirefoxProfileSession[]): ImportChoice[] {
  return profiles.flatMap((profile) => {
    // `sites` is missing when the main process predates it (in development the
    // renderer hot-reloads but main is only compiled on `npm start`).
    const sites = profile.session?.sites ?? [];
    return sites.length
      ? sites.map((site) => ({ key: `${profile.path}|${site.site}`, profile, site }))
      : [{ key: profile.path, profile }];
  });
}

/** An imported session is a few KB, a login's profile several MB. */
function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** macOS: closing Firefox's window doesn't quit it; main watches for that, but ⌘Q is the sure way. */
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const closeFirefoxHint = isMac ? "close its window or quit Firefox (⌘Q)" : "close it";

/** "login": open a fresh Firefox to log in. "import": reuse the user's own Firefox session. */
type Mode = "login" | "import";

interface InteractiveLoginFlowProps {
  userId?: string;
}

export const InteractiveLoginFlow: React.FC<InteractiveLoginFlowProps> = ({
  userId: initialUserId = "",
}) => {
  const { addError } = useError();
  const [url, setUrl] = useState("https://www.vinted.es/member/signup/select_type?ref_url=%2F");
  const [profileName, setProfileName] = useState("");
  const [timeout, setTimeout] = useState(5);
  const [userEmail, setUserEmail] = useState(initialUserId);
  const [vintedEmail, setVintedEmail] = useState("");
  const [vintedMemberId, setVintedMemberId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<LoginProgress[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // A ref, not state: the IPC listeners are registered once, and state they
  // closed over would stay at its first value (false) forever.
  const hasErrorRef = useRef(false);
  const setHasError = (value: boolean) => {
    hasErrorRef.current = value;
  };
  const [mode, setMode] = useState<Mode>("login");
  const modeChosen = useRef(false);
  const [firefoxProfiles, setFirefoxProfiles] = useState<FirefoxProfileSession[]>([]);
  const [selectedChoiceKey, setSelectedChoiceKey] = useState("");
  const [isScanning, setIsScanning] = useState(false);

  const scanFirefoxProfiles = useCallback(async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.findFirefoxSessions) return;
    setIsScanning(true);
    try {
      const response = await electronAPI.findFirefoxSessions();
      const profiles: FirefoxProfileSession[] = response?.profiles ?? [];
      setFirefoxProfiles(profiles);
      const loggedIn = importChoices(profiles).filter((c) => c.site);
      setSelectedChoiceKey((current) =>
        loggedIn.some((c) => c.key === current) ? current : loggedIn[0]?.key ?? ""
      );
      // Offer the import first when there's a session to import, unless the
      // user already picked a mode themselves.
      if (loggedIn.length && !modeChosen.current) setMode("import");
    } catch (err) {
      addError(err, "InteractiveLoginFlow.scanFirefoxProfiles");
    } finally {
      setIsScanning(false);
    }
  }, [addError]);

  useEffect(() => {
    scanFirefoxProfiles();
  }, [scanFirefoxProfiles]);

  const chooseMode = (next: Mode) => {
    modeChosen.current = true;
    setMode(next);
    setError(null);
  };

  const choices = importChoices(firefoxProfiles);
  const selectedChoice = choices.find((c) => c.key === selectedChoiceKey && c.site);

  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    const handleProgress = (data: LoginProgress) => {
      console.log("[UI] Progress:", data);

      // Detect error/warning messages from progress events
      const step = data.step.toUpperCase();
      const isError = step.includes("ERROR") || step.includes("FAILED");
      const isWarning = step.includes("WARNING");

      if (isError || isWarning) {
        // Extract clean message (remove emoji prefix and formatting)
        let cleanMsg = data.message
          .replace(/^[⚠️❌🔴📛✋]+\s*/, "") // Remove emoji
          .replace(/^[^:]+:\s*/, ""); // Remove "Step:" prefix

        // Try to extract actual error message if JSON is embedded
        try {
          if (cleanMsg.includes("{") && cleanMsg.includes("}")) {
            const jsonMatch = cleanMsg.match(/\{.*\}/);
            if (jsonMatch) {
              const jsonObj = JSON.parse(jsonMatch[0]);
              if (jsonObj.message) {
                cleanMsg = jsonObj.message;
              }
            }
          }
        } catch (e) {
          // Keep original message if JSON parsing fails
        }

        const progressError = new Error(cleanMsg);
        console.log(`[UI] Progress ${isError ? "error" : "warning"} detected:`, cleanMsg);

        // Mark that an error occurred - this will stop showing progress
        setHasError(true);
        setProgress([]);
        setResult(null);

        addError(progressError, `InteractiveLoginFlow.IPC.${step}`);
      } else if (!hasErrorRef.current) {
        // Only add progress if no error has occurred yet
        setProgress((prev) => [...prev, data]);
      }
    };

    const handleError = (data: { error: string; timestamp: string }) => {
      console.log("[UI] ERROR RECEIVED - Stopping everything:", data);
      const error = new Error(data.error);
      addError(error, "InteractiveLoginFlow.IPC");
      setError(data.error);
      setIsLoading(false);
      setHasError(true);

      // Clear progress when error occurs - show only the error
      setProgress([]);
      setResult(null);

      console.log("[UI] Progress cleared, error-only state activated");
    };

    // Register listeners and get references for cleanup
    const progressListener = electronAPI.onInteractiveLoginProgress?.(handleProgress);
    const errorListener = electronAPI.onInteractiveLoginError?.(handleError);

    return () => {
      if (progressListener && electronAPI.offInteractiveLoginProgress) {
        electronAPI.offInteractiveLoginProgress(progressListener);
      }
      if (errorListener && electronAPI.offInteractiveLoginError) {
        electronAPI.offInteractiveLoginError(errorListener);
      }
    };
  }, []);

  const handleStartLogin = async () => {
    if (!vintedEmail.trim()) {
      const validationError = ErrorHandler.createError(
        "VALIDATION_ERROR",
        "Vinted email is required",
        { field: "vintedEmail" }
      );
      addError(validationError, "InteractiveLoginFlow");
      return;
    }

    setError(null);
    setProgress([]);
    setResult(null);
    setHasError(false);
    setIsLoading(true);

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        throw new Error("Electron API not available");
      }

      // No token here: main uploads with the session it holds, and reports an
      // expired one back through interactive-login-error / auth:unauthorized.
      // Auto-generate profile name if not provided
      const finalProfileName = profileName.trim() || `vinted_${Date.now()}`;

      if (mode === "import" && !selectedChoice) {
        throw new Error("Choose the Firefox profile you're logged in to Vinted with");
      }

      const response =
        mode === "import"
          ? await electronAPI.importFirefoxSession({
              profilePath: selectedChoice!.profile.path,
              site: selectedChoice!.site!.site,
              profileName: finalProfileName,
              userEmail: userEmail.trim(),
              vintedEmail: vintedEmail.trim(),
              vintedMemberId: vintedMemberId.trim() || undefined,
              uploadToS3: true,
            })
          : await electronAPI.interactiveLogin({
              url: url.trim(),
              profileName: finalProfileName,
              timeout: timeout * 60, // Convert minutes to seconds
              userEmail: userEmail.trim(),
              vintedEmail: vintedEmail.trim(),
              vintedMemberId: vintedMemberId.trim() || undefined,
              uploadToS3: true,
            });

      if (response.success) {
        setResult(response.session);
      } else {
        const errorMsg = response.message || response.error || "Login failed";
        const err = new Error(errorMsg);
        addError(err, "InteractiveLoginFlow");
        setError(errorMsg);
      }
    } catch (err) {
      addError(err, "InteractiveLoginFlow.handleStartLogin");
      const msg = err instanceof Error ? err.message : String(err);

      // Check if this is a session/auth error
      if (msg.includes("Session error") || msg.includes("access token") || msg.includes("not authenticated")) {
        setError("Your session has expired. Please log in again from the login page.");
      } else {
        setError(`Failed to start: ${msg}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setProgress([]);
    setResult(null);
    setError(null);
    setHasError(false);
    setShowAdvanced(false);
  };

  // Map technical steps to friendly messages
  const getFriendlyMessage = (step: string, originalMessage: string): string => {
    const friendlyMessages: { [key: string]: string } = {
      "START": "Starting login process...",
      "IMPORT_START": "Reading your Firefox session...",
      "BROWSER_LAUNCH": "Opening browser...",
      "WAITING_FOR_LOGIN": isMac
        ? "Waiting for you to log in (close the window or quit Firefox with ⌘Q when done)..."
        : "Waiting for you to log in (close browser when done)...",
      "EXTRACT_COMPLETE": "Session saved successfully!",
      "COMPRESS_START": "Saving your session...",
      "UPLOAD_START": "Uploading to cloud...",
      "UPLOAD_SUCCESS": "Upload complete!",
    };
    return friendlyMessages[step] || originalMessage;
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="animate-fade-in">
        {/* Header, set like the web app's page titles */}
        <div className="mb-8">
          <h1 className="display text-[28px]">Connect your Vinted account</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-pretty text-muted-foreground">
            {mode === "import"
              ? "Already logged in to Vinted in Firefox? We'll reuse that session, so there's no need to log in again."
              : `We'll open Firefox for you to log in. Just ${closeFirefoxHint} when done, and your session will be saved automatically.`}
          </p>
        </div>

        {/* Main Content */}
        {!result ? (
          <Card>
            <CardHeader>
              <CardTitle>Session</CardTitle>
              <CardDescription>
                Choose how to get your Vinted session, then enter the email of that Vinted account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Mode: fresh login, or reuse the session in the user's Firefox */}
              <div
                role="radiogroup"
                aria-label="How to get your Vinted session"
                className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1"
              >
                {([
                  { value: "login", label: "Log in with Firefox", Icon: LogIn },
                  { value: "import", label: "Use my Firefox session", Icon: Import },
                ] as const).map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => chooseMode(value)}
                    disabled={isLoading}
                    className={`flex h-8 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 disabled:opacity-50 ${
                      mode === value
                        ? // In dark the card is darker than the track; the accent surface sits above it
                          "bg-card text-foreground shadow-[var(--highlight),var(--shadow-xs)] dark:bg-accent"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Error Alert */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Something went wrong</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Firefox profile picker (import mode) */}
              {mode === "import" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Firefox profile</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={scanFirefoxProfiles}
                      disabled={isScanning || isLoading}
                    >
                      <RefreshCw className={isScanning ? "animate-spin" : ""} />
                      <span>Refresh</span>
                    </Button>
                  </div>

                  {firefoxProfiles.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-input/60 p-4 text-sm text-muted-foreground">
                      {isScanning ? "Looking for Firefox profiles..." : "No Firefox profiles found on this computer."}
                    </p>
                  ) : (
                    <div role="radiogroup" aria-label="Firefox profile" className="space-y-2">
                      {choices.map(({ key, profile, site }) => {
                        const usable = !!site;
                        const selected = key === selectedChoiceKey;
                        return (
                          <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={!usable || isLoading}
                            onClick={() => setSelectedChoiceKey(key)}
                            className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-[background-color,border-color] duration-150 disabled:cursor-not-allowed ${
                              selected
                                ? "border-primary/60 bg-primary/8"
                                : "border-border bg-card hover:border-input/60 hover:bg-accent/60"
                            } ${usable ? "" : "opacity-60"}`}
                          >
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                selected ? "border-primary" : "border-input"
                              }`}
                            >
                              {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {profile.name}
                                </span>
                                {profile.isDefault && (
                                  <span className="rounded-full border border-border bg-secondary px-2 py-px text-[11px] font-medium text-muted-foreground">
                                    Default
                                  </span>
                                )}
                              </span>
                              <span
                                className={`mt-0.5 block text-xs ${
                                  usable ? "text-success" : "text-muted-foreground"
                                }`}
                              >
                                {profile.error
                                  ? "Couldn't read this profile"
                                  : !profile.session?.sites
                                    ? "App needs a restart to read this profile"
                                    : usable
                                    ? `Logged in on ${site!.site}` + (site!.userId ? ` · member ${site!.userId}` : "")
                                    : profile.session.state === "anonymous"
                                      ? "Not logged in to Vinted"
                                      : "No Vinted session"}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Only your Vinted cookies are copied — nothing else from your browser. Firefox can stay open.
                    Not logged in? Open Vinted in Firefox, log in, then press Refresh.
                  </p>
                </div>
              )}

              {/* Email Input - Main Required Field */}
              <div className="grid gap-1.5">
                <Label htmlFor="email">Vinted email</Label>
                <Input
                  id="email"
                  type="email"
                  value={vintedEmail}
                  onChange={(e) => setVintedEmail(e.target.value)}
                  disabled={isLoading}
                  placeholder="you@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  The email of the Vinted account this session belongs to.
                </p>
              </div>

              {/* Progress Display */}
              {progress.length > 0 && (
                <div role="status">
                  <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/8 p-3.5">
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {progress[progress.length - 1] && getFriendlyMessage(
                          progress[progress.length - 1].step,
                          progress[progress.length - 1].message
                        )}
                      </p>
                      <div className="mt-2 space-y-1">
                        {progress.slice(0, -1).map((entry, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                            <span>{getFriendlyMessage(entry.step, entry.message)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Advanced Options */}
              <div className="border-t border-border pt-4">
                <button
                  type="button"
                  aria-expanded={showAdvanced}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 rounded-sm text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-150 ${showAdvanced ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                  Advanced options
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4 rounded-lg border border-border bg-muted/60 p-4">
                    {/* Timeout Input (only the login window waits) */}
                    {mode === "login" && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="timeout">Wait time (minutes)</Label>
                      <Input
                        id="timeout"
                        type="number"
                        value={timeout}
                        onChange={(e) => setTimeout(Math.max(1, parseInt(e.target.value) || 5))}
                        disabled={isLoading}
                        min="1"
                        max="60"
                      />
                      <p className="text-xs text-muted-foreground">
                        {isMac ? "How long to wait for you to close or quit Firefox" : "How long to wait for you to close the browser"}
                      </p>
                    </div>
                    )}

                    {/* Profile Name */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="profileName">Session name (optional)</Label>
                      <Input
                        id="profileName"
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        disabled={isLoading}
                        placeholder="Leave empty for auto-generated name"
                      />
                    </div>
                  </div>
                )}
              </div>
            </CardContent>

            {/* Footer with Button */}
            <CardFooter>
              <Button
                onClick={handleStartLogin}
                disabled={isLoading || !vintedEmail.trim() || (mode === "import" && !selectedChoice)}
                size="lg"
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    <span>{mode === "import" ? "Importing..." : "Starting..."}</span>
                  </>
                ) : mode === "import" ? (
                  "Import session"
                ) : (
                  "Open Firefox and log in"
                )}
              </Button>
            </CardFooter>
          </Card>
        ) : (
          /* Success Message */
          <Card>
            <CardContent className="flex flex-col items-center justify-center px-8 py-12 text-center">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-success/25 bg-success/10">
                <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />
              </div>
              <h2 className="display text-[22px]">Session saved</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Your Vinted session is saved and uploaded. Vinbot can now work with this account.
              </p>
              <p className="mt-1 text-xs text-muted-foreground" data-numeric>
                Session size: {formatSize(result.profile_archive_size || 0)}
              </p>
              <Button onClick={handleReset} variant="outline" className="mt-6">
                Save another session
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default InteractiveLoginFlow;
