import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { config } from "../config/config";
import { cn } from "@/lib/utils";

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  isLoading: boolean;
  error?: string;
  /** "Continue with Google"; left out while the API has Google off */
  google?: {
    onSignIn: () => void;
    onCancel: () => void;
    /** The user is in their browser picking an account */
    isWaiting: boolean;
  };
}

/** Inline links, as the web app's: primary colour, underline on hover. */
const linkClass =
  "rounded-sm font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30";

/** Google's "G" mark, in its brand colours as the guidelines require. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * The web app's full-width form button (IndButton): primary is the filled
 * indigo action, secondary an outlined surface.
 */
function FormButton({
  variant = "primary",
  busy,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  busy?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-60",
        variant === "primary"
          ? "border-transparent bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16),var(--shadow-xs)] hover:bg-primary/90"
          : "border-input/75 bg-card text-foreground shadow-[var(--highlight),var(--shadow-xs)] hover:border-input hover:bg-accent",
        className
      )}
      {...props}
    >
      {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * The signed-out screen, laid out like the web app's login
 * (components/auth/industrial-shell.tsx): the form in a quiet column and, when
 * the window is wide enough, the Vinbot character on a lit panel beside it.
 */
export default function LoginForm({
  onSubmit,
  isLoading,
  error,
  google,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError("");

    if (!email || !password) {
      setLocalError("Email and password are required");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLocalError("Please enter a valid email address");
      return;
    }

    try {
      await onSubmit(email, password);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Login failed. Please try again.";
      setLocalError(errorMessage);
    }
  };

  const shownError = error || localError;

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 px-8 py-3">
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
          <img src="brand/vinbot-mark-32.png" alt="" width={24} height={24} className="h-6 w-6" />
          Vinbot
          <span className="font-normal text-muted-foreground">Authenticator</span>
        </span>
        <ThemeToggle />
      </header>

      {/* Sized to fit the default 1200x800 window without scrolling */}
      <main className="grid flex-1 px-8 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8">
        <section className="flex flex-col">
          <div className="flex flex-1 items-center justify-center py-4">
            <div className="w-full max-w-[24rem] animate-fade-in">
              <div className="mb-7">
                <h1 className="display text-[30px]">Sign in</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-pretty text-muted-foreground">
                  With your Vinbot account.
                </p>
              </div>

              {google && (
                <div className="mb-5 grid gap-5">
                  {google.isWaiting ? (
                    <div
                      role="status"
                      className="flex min-h-10 items-center gap-2.5 rounded-lg border border-dashed border-input/75 px-3 py-2 text-sm text-muted-foreground"
                    >
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                      <span className="flex-1">Continue in your browser to sign in with Google.</span>
                      <button type="button" className={linkClass} onClick={google.onCancel}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <FormButton
                      type="button"
                      variant="secondary"
                      onClick={google.onSignIn}
                      disabled={isLoading}
                    >
                      <GoogleMark />
                      Continue with Google
                    </FormButton>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
                    <span className="flex-1 border-t border-border" />
                    or
                    <span className="flex-1 border-t border-border" />
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
                {shownError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm leading-relaxed"
                  >
                    {shownError}
                  </div>
                )}

                <div className="grid gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={isLoading}
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      className={cn(linkClass, "text-xs text-muted-foreground hover:text-foreground")}
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="current-password"
                    required
                  />
                </div>

                <FormButton type="submit" disabled={isLoading} busy={isLoading && !google?.isWaiting}>
                  {isLoading && !google?.isWaiting ? "Signing in..." : "Sign in"}
                </FormButton>
              </form>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-5 text-[13px] text-muted-foreground">
                <span>
                  No account yet?{" "}
                  <a href={`${config.web.baseUrl}/register`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    Sign up
                  </a>
                </span>
                <a href={`${config.web.baseUrl}/forgot-password`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  Forgot your password?
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* The one bold moment, as on the web: the character on a lit stage,
            gold (the bot's colour) glowing from behind it. */}
        <aside
          aria-hidden="true"
          className="relative hidden overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--highlight),var(--shadow-lg)] lg:block"
        >
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_42%,color-mix(in_oklab,var(--bot)_26%,transparent),transparent_70%),radial-gradient(70%_60%_at_80%_100%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_70%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_45%,black,transparent)]" />
          <div className="relative flex h-full items-center justify-center p-12">
            <img
              src="brand/vinbot-mascot.png"
              alt=""
              className="pointer-events-none h-[min(30rem,58vh)] w-auto animate-fade-in select-none object-contain drop-shadow-[0_24px_48px_rgb(0_0_0/0.25)]"
            />
          </div>
        </aside>
      </main>

      <footer className="px-8 pb-4 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Vinbot
      </footer>
    </div>
  );
}
