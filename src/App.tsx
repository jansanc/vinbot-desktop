import { useState, useEffect, useCallback, useRef } from "react";
import InteractiveLoginFlow from "./components/InteractiveLoginFlow";
import LoginForm from "./components/LoginForm";
import UserHeader from "./components/UserHeader";
import { AuthState } from "./types";
import {
  AuthService,
  AuthUser,
  SubscriptionError,
} from "./services/auth.service";
import { ErrorProvider } from "./contexts/ErrorContext";
import { ErrorToastContainer } from "./components/ErrorToast";
import { useError } from "./contexts/ErrorContext";
import { useI18n } from "./i18n/I18nContext";
import { signInErrorKey } from "./i18n/signInErrors";
import type { MessageKey } from "./i18n/messages";

function AppContent() {
  const { errors, removeError } = useError();
  const [authState, setAuthState] = useState<AuthState>("unauthenticated");
  const [user, setUser] = useState<AuthUser | null>(null);
  // A message key, so it follows a language change while it is shown
  const [authError, setAuthError] = useState<MessageKey | "">("");
  const { locale, t } = useI18n();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Waiting on the browser, where the user picks their Google account
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  // Hidden until the API says Google is switched on, like the web app
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const lastPlanCheck = useRef(0);

  useEffect(() => {
    let alive = true;
    AuthService.isGoogleSignInEnabled().then((enabled) => {
      if (alive) setGoogleEnabled(enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Re-read the user, plan included, from the server. The cached copy is only
   * what was true at login; a plan changed since (upgrade, downgrade,
   * cancellation) shows up here. A lost subscription signs the user out; a
   * network failure keeps the cached user rather than locking them out.
   */
  const refreshUser = useCallback(async () => {
    lastPlanCheck.current = Date.now();
    try {
      const fresh = await AuthService.fetchCurrentUser();
      setUser(fresh);
      return true;
    } catch (error) {
      if (error instanceof SubscriptionError) {
        await AuthService.logout();
        setUser(null);
        setAuthState("unauthenticated");
        setAuthError("login.noSubscription");
        return false;
      }
      // 401s are handled by the auth:unauthorized listener below.
      console.warn("[App] Could not refresh the user's plan:", error);
      return true;
    }
  }, []);

  useEffect(() => {
    // Check for existing session on mount and attempt refresh if needed
    const initializeAuth = async () => {
      const existingUser = AuthService.getUser();
      const existingSession = AuthService.getSession();

      if (
        !existingUser ||
        !existingSession ||
        !(await AuthService.hasMainSession())
      ) {
        AuthService.clearSession();
        return;
      }

      if (AuthService.isSessionValid()) {
        setUser(existingUser);
        setAuthState("authenticated");
        console.log("[App] Session valid, user authenticated");
        await refreshUser();
      } else {
        console.log("[App] Session expired, attempting to refresh...");
        try {
          const refreshedSession = await AuthService.refreshSession();
          if (refreshedSession) {
            // Refresh successful, get updated user
            const updatedUser = AuthService.getUser();
            if (updatedUser) {
              setUser(updatedUser);
              setAuthState("authenticated");
              console.log("[App] Session refreshed successfully");
              await refreshUser();
              return;
            }
          }
        } catch (error) {
          console.error("[App] Token refresh failed:", error);
        }

        // If we get here, refresh failed or user data is missing
        AuthService.clearSession();
        setAuthError("login.sessionExpired");
      }
    };

    initializeAuth();

    // Listen for unauthorized (401) errors
    const handleUnauthorized = async (event: Event) => {
      const customEvent = event as CustomEvent;
      console.warn("Session expired or unauthorized:", customEvent.detail);

      // Clear session immediately
      AuthService.clearSession();
      setUser(null);
      setAuthState("unauthenticated");
      setAuthError("login.sessionExpired");
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);

    // Main refreshes the session itself right before an upload; keep ours in
    // step, or the next launch would refresh with a superseded token.
    const offSessionRefreshed = window.electronAPI?.auth?.onSessionRefreshed?.(
      (session) => {
        if (AuthService.getSession()) AuthService.saveSession(session);
      },
    );

    // Uploads and links run in main, outside the api bridge that raises
    // `auth:unauthorized`; main reports their 401s here instead.
    const offUnauthorized = window.electronAPI?.auth?.onUnauthorized?.(
      (detail) =>
        window.dispatchEvent(
          new CustomEvent("auth:unauthorized", {
            detail: {
              status: 401,
              statusText: "Unauthorized",
              message: detail.message,
            },
          }),
        ),
    );

    return () => {
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
      offSessionRefreshed?.();
      offUnauthorized?.();
    };
  }, [refreshUser]);

  // Check the plan again whenever the user comes back to the window (at most
  // once a minute), so a change made on the website shows without a restart.
  useEffect(() => {
    if (authState !== "authenticated") return;
    const onFocus = () => {
      if (Date.now() - lastPlanCheck.current > 60_000) refreshUser();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authState, refreshUser]);

  // Shared by both sign-ins; a null result (Google cancelled) changes nothing
  const signIn = async (
    attempt: () => Promise<{ user: AuthUser } | null>,
    fallbackError: MessageKey
  ) => {
    setIsAuthenticating(true);
    setAuthError("");

    try {
      // Already read from /auth/me by the AuthService call.
      const result = await attempt();
      if (!result) return;
      lastPlanCheck.current = Date.now();
      setUser(result.user);
      setAuthState("authenticated");
    } catch (err) {
      console.error("[App] Sign-in failed:", err);
      setAuthError(signInErrorKey(err, fallbackError));
      setAuthState("error");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogin = (email: string, password: string) =>
    signIn(() => AuthService.login(email, password), "login.loginFailed");

  const handleGoogleLogin = async () => {
    setIsGoogleSigningIn(true);
    try {
      await signIn(() => AuthService.loginWithGoogle(locale), "google.failed");
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleCancelGoogleLogin = () => {
    AuthService.cancelGoogleLogin().catch((err) =>
      console.warn("[App] Could not cancel Google sign-in:", err)
    );
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await AuthService.logout();
      setUser(null);
      setAuthState("unauthenticated");
      setAuthError("");
    } catch (err) {
      console.error("Logout failed:", err);
      setUser(null);
      setAuthState("unauthenticated");
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Show login form if not authenticated
  if (authState !== "authenticated" || !user) {
    return (
      <>
        <LoginForm
          onSubmit={handleLogin}
          isLoading={isAuthenticating}
          error={authError ? t(authError) : undefined}
          google={
            googleEnabled
              ? {
                  onSignIn: handleGoogleLogin,
                  onCancel: handleCancelGoogleLogin,
                  isWaiting: isGoogleSigningIn,
                }
              : undefined
          }
        />
        <ErrorToastContainer errors={errors} onDismiss={removeError} />
      </>
    );
  }

  // Show interactive login if authenticated
  return (
    <>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <UserHeader
          user={user}
          onLogout={handleLogout}
          isLoggingOut={isLoggingOut}
        />
        <main className="flex flex-1 flex-col">
          <InteractiveLoginFlow userId={user?.id || ""} />
        </main>
      </div>
      <ErrorToastContainer errors={errors} onDismiss={removeError} />
    </>
  );
}

function App() {
  return (
    <ErrorProvider>
      <AppContent />
    </ErrorProvider>
  );
}

export default App;
