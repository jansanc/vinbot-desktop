import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import { useError } from "../contexts/ErrorContext";
import { ErrorHandler } from "../utils/errorHandler";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";

interface LoginProgress {
  step: string;
  message: string;
  timestamp: string;
}

/** A login's profile is several MB; small ones still read in KB. */
function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** macOS: closing Firefox's window doesn't quit it; main watches for that, but ⌘Q is the sure way. */
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/** How long to wait for the user to close Firefox after logging in. */
const LOGIN_TIMEOUT_SECONDS = 5 * 60;

interface InteractiveLoginFlowProps {
  userId?: string;
}

export const InteractiveLoginFlow: React.FC<InteractiveLoginFlowProps> = ({
  userId: initialUserId = "",
}) => {
  const { addError } = useError();
  const { t } = useI18n();
  const [url, setUrl] = useState("https://www.vinted.es/member/signup/select_type?ref_url=%2F");
  const [userEmail, setUserEmail] = useState(initialUserId);
  const [vintedEmail, setVintedEmail] = useState("");
  const [vintedMemberId, setVintedMemberId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<LoginProgress[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: the IPC listeners are registered once, and state they
  // closed over would stay at its first value (false) forever.
  const hasErrorRef = useRef(false);
  const setHasError = (value: boolean) => {
    hasErrorRef.current = value;
  };

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
        t("session.vintedEmailRequired"),
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
      const response = await electronAPI.interactiveLogin({
        url: url.trim(),
        profileName: `vinted_${Date.now()}`,
        timeout: LOGIN_TIMEOUT_SECONDS,
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
        setError(t("session.sessionExpired"));
      } else {
        setError(t("session.failedToStart", { message: msg }));
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
  };

  // Main reports steps by name; known ones are shown in the app's language
  const getFriendlyMessage = (step: string, originalMessage: string): string => {
    const known = ["START", "BROWSER_LAUNCH", "WAITING_FOR_LOGIN", "EXTRACT_COMPLETE", "COMPRESS_START", "UPLOAD_START", "UPLOAD_SUCCESS"];
    if (!known.includes(step)) return originalMessage;
    const key = step === "WAITING_FOR_LOGIN" && isMac ? "WAITING_FOR_LOGIN_MAC" : step;
    return t(`steps.${key}` as MessageKey);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="animate-fade-in">
        {/* Header, set like the web app's page titles */}
        <div className="mb-8">
          <h1 className="display text-[28px]">{t("session.title")}</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-pretty text-muted-foreground">
            {t("session.introLogin", { closeHint: t(isMac ? "session.closeHintMac" : "session.closeHint") })}
          </p>
        </div>

        {/* Main Content */}
        {!result ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("session.cardTitle")}</CardTitle>
              <CardDescription>
                {t("session.cardDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Error Alert */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t("session.errorTitle")}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Email Input - Main Required Field */}
              <div className="grid gap-1.5">
                <Label htmlFor="email">{t("session.vintedEmail")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={vintedEmail}
                  onChange={(e) => setVintedEmail(e.target.value)}
                  disabled={isLoading}
                  placeholder={t("login.emailPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("session.vintedEmailHint")}
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
            </CardContent>

            {/* Footer with Button */}
            <CardFooter>
              <Button
                onClick={handleStartLogin}
                disabled={isLoading || !vintedEmail.trim()}
                size="lg"
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    <span>{t("session.starting")}</span>
                  </>
                ) : (
                  t("session.loginButton")
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
              <h2 className="display text-[22px]">{t("session.savedTitle")}</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {t("session.savedBody")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground" data-numeric>
                {t("session.sessionSize", { size: formatSize(result.profile_archive_size || 0) })}
              </p>
              <Button onClick={handleReset} variant="outline" className="mt-6">
                {t("session.saveAnother")}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default InteractiveLoginFlow;
