import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";

/** A login's profile is several MB; small ones still read in KB. */
function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** macOS names Firefox's location differently in the not-found message. */
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/** The progress steps main reports that the user sees, in order (see steps in the messages). */
const STEPS = ["OPENING_FIREFOX", "WAITING_FOR_LOGIN", "LOGGED_IN", "SAVING", "UPLOADING", "LINKING"] as const;
type Step = (typeof STEPS)[number];
const isStep = (step: string): step is Step => (STEPS as readonly string[]).includes(step);

/** Until the window closes the login can still be cancelled. */
const CANCELLABLE_STEPS: Step[] = ["OPENING_FIREFOX", "WAITING_FOR_LOGIN"];

interface InteractiveLoginFlowProps {
  /** The signed-in Vinbot user's id, which the session is saved under. */
  userId?: string;
}

export const InteractiveLoginFlow: React.FC<InteractiveLoginFlowProps> = ({ userId = "" }) => {
  const { t } = useI18n();
  const [vintedEmail, setVintedEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      window.electronAPI?.onInteractiveLoginProgress?.(({ step }) => {
        if (isStep(step)) setSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
      }),
    []
  );

  /** What went wrong, in the user's language where main says why. */
  const errorText = (response: InteractiveLoginResponse): string => {
    switch (response.code) {
      case "LOGIN_TIMEOUT":
        return t("session.errorTimeout");
      case "FIREFOX_NOT_FOUND":
        return t(isMac ? "session.errorFirefoxNotFoundMac" : "session.errorFirefoxNotFound");
      case "SESSION_EXPIRED":
        return t("session.sessionExpired");
      case "LOGIN_IN_PROGRESS":
        return t("session.errorInProgress");
      default:
        return t("session.errorFailed", { message: response.message });
    }
  };

  const handleStartLogin = async () => {
    if (!vintedEmail.trim()) return;
    setError(null);
    setSteps([]);
    setIsLoading(true);

    try {
      const response = await window.electronAPI.interactiveLogin({
        userEmail: userId.trim(),
        vintedEmail: vintedEmail.trim(),
      });
      if (response.success) {
        setSavedSize(response.session?.profile_archive_size ?? 0);
      } else if (response.code !== "LOGIN_CANCELLED") {
        setError(errorText(response));
      }
    } catch (err) {
      setError(t("session.errorFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsLoading(false);
      setSteps([]);
    }
  };

  const handleReset = () => {
    setSteps([]);
    setSavedSize(null);
    setError(null);
  };

  const currentStep = steps[steps.length - 1];
  const canCancel = isLoading && (!currentStep || CANCELLABLE_STEPS.includes(currentStep));

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="animate-fade-in">
        {/* Header, set like the web app's page titles */}
        <div className="mb-8">
          <h1 className="display text-[28px]">{t("session.title")}</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-pretty text-muted-foreground">
            {t("session.intro")}
          </p>
        </div>

        {savedSize === null ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("session.cardTitle")}</CardTitle>
              <CardDescription>{t("session.cardDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t("session.errorTitle")}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

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
                <p className="text-xs text-muted-foreground">{t("session.vintedEmailHint")}</p>
              </div>

              {/* Progress: the current step, with the ones already done under it */}
              {currentStep && (
                <div role="status">
                  <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/8 p-3.5">
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {t(`steps.${currentStep}` as MessageKey)}
                      </p>
                      <div className="mt-2 space-y-1">
                        {steps.slice(0, -1).map((step) => (
                          <div key={step} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                            <span>{t(`steps.${step}` as MessageKey)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>

            <CardFooter className="flex-col gap-2">
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
              {canCancel && (
                <Button
                  onClick={() => window.electronAPI.cancelInteractiveLogin()}
                  variant="ghost"
                  size="lg"
                  className="w-full"
                >
                  {t("session.cancel")}
                </Button>
              )}
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
                {t("session.sessionSize", { size: formatSize(savedSize) })}
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
