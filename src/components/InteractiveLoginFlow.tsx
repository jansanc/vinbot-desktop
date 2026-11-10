import React, { useState, useEffect, useCallback, useRef } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import SetupSteps from "./SetupSteps";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { ApiBridge } from "../services/api.bridge";
import { config } from "../config/config";
import { cn } from "@/lib/utils";

/** macOS names Firefox's location (and where its window hides) differently. */
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/** The progress steps main reports that the user sees, in order (see steps in the messages). */
const STEPS = ["OPENING_FIREFOX", "WAITING_FOR_LOGIN", "LOGGED_IN", "SAVING", "LINKING"] as const;
type Step = (typeof STEPS)[number];
const isStep = (step: string): step is Step => (STEPS as readonly string[]).includes(step);

/** Until the window closes the login can still be cancelled. */
const CANCELLABLE_STEPS: Step[] = ["OPENING_FIREFOX", "WAITING_FOR_LOGIN"];

const HOW_STEPS: MessageKey[] = ["session.how1", "session.how2", "session.how3"];

/*
 * Per Vinbot user, in this computer's storage. Only conveniences: storage may
 * be unavailable, and then the field starts empty and no mismatch is caught.
 *  - the last Vinted email used, so a reconnect is one click
 *  - which Vinted member each email linked from here was, so a login to a
 *    different account is noticed before it is saved (see account-match.ts)
 */
const lastEmailKey = (userId: string) => `vinbot:lastVintedEmail:${userId}`;
const membersKey = (userId: string) => `vinbot:vintedMembers:${userId}`;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it
  }
}

/** email (lower case) -> Vinted member id */
function readMembers(userId: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readStored(membersKey(userId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function rememberMember(userId: string, email: string, memberId: string) {
  const members = readMembers(userId);
  // One email per member: a "save anyway" under a new email replaces the old
  for (const [known, id] of Object.entries(members)) if (id === memberId) delete members[known];
  members[email.trim().toLowerCase()] = memberId;
  writeStored(membersKey(userId), JSON.stringify(members));
}

/** "4:05" */
const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;

interface InteractiveLoginFlowProps {
  /** The signed-in Vinbot user's id, which the session is saved under. */
  userId?: string;
}

export const InteractiveLoginFlow: React.FC<InteractiveLoginFlowProps> = ({ userId = "" }) => {
  const { t, locale } = useI18n();
  const [vintedEmail, setVintedEmail] = useState(() => readStored(lastEmailKey(userId)) ?? "");
  // The account the last save was for, named in the success message
  const [savedEmail, setSavedEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A login that went to a different Vinted account, held in main until the user decides
  const [mismatch, setMismatch] = useState<{ email: string; linkedAs?: string } | null>(null);
  // When the Firefox window became ready for the login, for the time left
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Null until loaded; stays null if the list can't be read (the form still works)
  const [accounts, setAccounts] = useState<VintedAccountSummary[] | null>(null);

  useEffect(
    () =>
      window.electronAPI?.onInteractiveLoginProgress?.(({ step }) => {
        if (!isStep(step)) return;
        if (step === "WAITING_FOR_LOGIN") setWaitingSince(Date.now());
        setSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
      }),
    []
  );

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await ApiBridge.vintedAccounts());
    } catch (err) {
      console.warn("[Session] Could not list the Vinted accounts:", err);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // A login held back in main is dropped if the user leaves (e.g. logs out)
  const mismatchRef = useRef(mismatch);
  mismatchRef.current = mismatch;
  useEffect(
    () => () => {
      if (mismatchRef.current) window.electronAPI?.discardPendingLogin?.();
    },
    []
  );

  const currentStep = steps[steps.length - 1];
  const isWaiting = isLoading && currentStep === "WAITING_FOR_LOGIN";

  // Tick the time left while Firefox waits for the login
  useEffect(() => {
    if (!isWaiting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isWaiting]);

  const secondsLeft =
    waitingSince === null
      ? null
      : Math.max(0, config.vinted.loginTimeoutSeconds - Math.floor((now - waitingSince) / 1000));

  /** What went wrong, in the user's language where main says why. */
  const errorText = (response: InteractiveLoginResponse): string => {
    switch (response.code) {
      case "LOGIN_TIMEOUT":
        return t("session.errorTimeout");
      case "NOT_LOGGED_IN":
        return t("session.errorNotLoggedIn");
      case "FIREFOX_NOT_FOUND":
        return t(isMac ? "session.errorFirefoxNotFoundMac" : "session.errorFirefoxNotFound");
      case "FIREFOX_FAILED":
        return t("session.errorFirefoxFailed", { message: response.message });
      case "SESSION_EXPIRED":
        return t("session.sessionExpired");
      case "LOGIN_IN_PROGRESS":
        return t("session.errorInProgress");
      default:
        return t("session.errorFailed", { message: response.message });
    }
  };

  /** Shared by a fresh login and "save anyway": what a finished attempt means for the screen. */
  const settle = (email: string, response: InteractiveLoginResponse) => {
    if (response.success) {
      writeStored(lastEmailKey(userId), email);
      if (response.vintedMemberId) rememberMember(userId, email, response.vintedMemberId);
      setSavedEmail(email);
      setSaved(true);
      loadAccounts();
    } else if (response.code === "ACCOUNT_MISMATCH") {
      setMismatch({ email, linkedAs: response.linkedAs });
    } else if (response.code !== "LOGIN_CANCELLED") {
      setError(errorText(response));
    }
  };

  const run = async (email: string, attempt: () => Promise<InteractiveLoginResponse>) => {
    setError(null);
    setMismatch(null);
    setSteps([]);
    setWaitingSince(null);
    setIsLoading(true);
    try {
      settle(email, await attempt());
    } catch (err) {
      setError(t("session.errorFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsLoading(false);
      setSteps([]);
      setWaitingSince(null);
    }
  };

  const startLogin = (emailArg?: string) => {
    const email = (emailArg ?? vintedEmail).trim();
    if (!email || isLoading) return;
    if (emailArg) setVintedEmail(email);
    const knownAccounts = Object.entries(readMembers(userId)).map(([known, memberId]) => ({
      email: known,
      memberId,
    }));
    return run(email, () =>
      window.electronAPI.interactiveLogin({
        userEmail: userId.trim(),
        vintedEmail: email,
        // So Firefox asks Vinted and the sign-in pages for the user's language
        locale,
        knownAccounts,
      })
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startLogin();
  };

  const handleSaveAnyway = () => {
    if (!mismatch) return;
    const { email } = mismatch;
    return run(email, () => window.electronAPI.confirmPendingLogin());
  };

  const handleLoginAgain = async () => {
    if (!mismatch) return;
    const { email } = mismatch;
    await window.electronAPI.discardPendingLogin();
    startLogin(email);
  };

  const handleReset = () => {
    setSteps([]);
    setSaved(false);
    setError(null);
    setMismatch(null);
    // "Connect another account": start from an empty field
    setVintedEmail("");
  };

  const handleReconnect = (email: string) => {
    setSaved(false);
    startLogin(email);
  };

  const canCancel = isLoading && (!currentStep || CANCELLABLE_STEPS.includes(currentStep));
  const hasAccounts = !!accounts?.length;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="animate-fade-in">
        {/* Header, set like the web app's page titles */}
        <div className="mb-8">
          <div className="mb-5">
            <SetupSteps current={2} />
          </div>
          <h1 className="display text-[28px]">{t("session.title")}</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-pretty text-muted-foreground">
            {t("session.intro")}
          </p>
        </div>

        <div className="space-y-6">
          {/* The accounts already connected, each a click away from a fresh login */}
          {hasAccounts && (
            <Card>
              <CardHeader>
                <CardTitle>{t("session.accountsTitle")}</CardTitle>
                <CardDescription>{t("session.accountsDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {accounts!.map((account) => {
                    const needsReconnect = account.sessionStatus === "unhealthy";
                    return (
                      <li key={account.id} className="flex items-center gap-3 px-3.5 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{account.vintedEmail}</span>
                            {account.isDisabled ? (
                              <StatusBadge tone="muted">{t("session.statusDisabled")}</StatusBadge>
                            ) : needsReconnect ? (
                              <StatusBadge tone="warning">{t("session.statusUnhealthy")}</StatusBadge>
                            ) : account.sessionStatus === "healthy" ? (
                              <StatusBadge tone="success">{t("session.statusHealthy")}</StatusBadge>
                            ) : null}
                          </div>
                          {account.lastLoginAt && !Number.isNaN(Date.parse(account.lastLoginAt)) && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {t("session.lastConnected", { date: dateFormat.format(new Date(account.lastLoginAt)) })}
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant={needsReconnect ? "default" : "outline"}
                          size="sm"
                          disabled={isLoading || !!mismatch}
                          onClick={() => handleReconnect(account.vintedEmail)}
                        >
                          <RefreshCw aria-hidden />
                          {t("session.reconnect")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {!saved ? (
            <Card>
              <form onSubmit={handleSubmit} noValidate>
                <CardHeader>
                  <CardTitle>{t(hasAccounts ? "session.newCardTitle" : "session.cardTitle")}</CardTitle>
                  <CardDescription>{t("session.cardDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* What happens next, so the Firefox window is expected */}
                  {!isLoading && !mismatch && (
                    <ol className="space-y-2.5">
                      {HOW_STEPS.map((key, i) => (
                        <li key={key} className="flex items-start gap-3 text-sm leading-relaxed">
                          <span
                            aria-hidden="true"
                            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary"
                          >
                            {i + 1}
                          </span>
                          <span>{t(key)}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>{t("session.errorTitle")}</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {/* Logged in to another account than the email: nothing saved until the user says */}
                  {mismatch && !isLoading && (
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>{t("session.mismatchTitle")}</AlertTitle>
                      <AlertDescription>
                        <p>
                          {mismatch.linkedAs
                            ? t("session.mismatchLinkedAs", { email: mismatch.email, linkedAs: mismatch.linkedAs })
                            : t("session.mismatchBody", { email: mismatch.email })}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" size="sm" onClick={handleLoginAgain}>
                            {t("session.mismatchRetry")}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={handleSaveAnyway}>
                            {t("session.mismatchSave", { email: mismatch.email })}
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid gap-1.5">
                    <Label htmlFor="vinted-email">{t("session.vintedEmail")}</Label>
                    <Input
                      id="vinted-email"
                      type="email"
                      value={vintedEmail}
                      onChange={(e) => setVintedEmail(e.target.value)}
                      disabled={isLoading || !!mismatch}
                      placeholder={t("login.emailPlaceholder")}
                      autoComplete="off"
                      aria-describedby="vinted-email-hint"
                      autoFocus
                    />
                    <p id="vinted-email-hint" className="text-xs text-muted-foreground">
                      {t("session.vintedEmailHint")}
                    </p>
                  </div>

                  {/* Progress: the current step, with the ones already done under it */}
                  {currentStep && (
                    <div role="status">
                      <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/8 p-3.5">
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="text-sm font-medium text-foreground">
                              {t(`steps.${currentStep}` as MessageKey)}
                            </p>
                            {isWaiting && secondsLeft !== null && (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {t("session.timeLeft", { time: formatClock(secondsLeft) })}
                              </span>
                            )}
                          </div>
                          {isWaiting && (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {t(isMac ? "session.firefoxHintMac" : "session.firefoxHint")}
                            </p>
                          )}
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

                  <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <Lock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{t("session.privacy")}</span>
                  </p>
                </CardContent>

                {!mismatch && (
                  <CardFooter className="flex-col gap-2">
                    <Button
                      type="submit"
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
                        type="button"
                        onClick={() => window.electronAPI.cancelInteractiveLogin()}
                        variant="ghost"
                        size="lg"
                        className="w-full"
                      >
                        {t("session.cancel")}
                      </Button>
                    )}
                  </CardFooter>
                )}
              </form>
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
                  {t("session.savedBody", { email: savedEmail })}
                </p>
                <Button onClick={handleReset} variant="outline" className="mt-6">
                  {t("session.saveAnother")}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

/** A small tinted label for an account's state. */
function StatusBadge({ tone, children }: { tone: "success" | "warning" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        tone === "success" && "border-success/25 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "muted" && "border-border bg-secondary text-secondary-foreground"
      )}
    >
      {children}
    </span>
  );
}

export default InteractiveLoginFlow;
