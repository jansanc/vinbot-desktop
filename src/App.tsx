import { useState, useEffect } from "react";
import InteractiveLoginFlow from "./components/InteractiveLoginFlow";
import LoginForm from "./components/LoginForm";
import UserHeader from "./components/UserHeader";
import { AuthState } from "./types";
import { AuthService, AuthUser } from "./services/auth.service";
import { config } from "./config/config";
import { ErrorProvider } from "./contexts/ErrorContext";
import { ErrorToastContainer } from "./components/ErrorToast";
import { useError } from "./contexts/ErrorContext";

function AppContent() {
  const { errors, removeError } = useError();
  const [authState, setAuthState] = useState<AuthState>("unauthenticated");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string>("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);


  useEffect(() => {
    // Check for existing session on mount and attempt refresh if needed
    const initializeAuth = async () => {
      const existingUser = AuthService.getUser();
      const existingSession = AuthService.getSession();

      if (!existingUser || !existingSession) {
        AuthService.clearSession();
        return;
      }

      if (AuthService.isSessionValid()) {
        setUser(existingUser);
        setAuthState("authenticated");
        console.log("[App] Session valid, user authenticated");
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
              return;
            }
          }
        } catch (error) {
          console.error("[App] Token refresh failed:", error);
        }

        // If we get here, refresh failed or user data is missing
        AuthService.clearSession();
        setAuthError("Your session has expired. Please log in again.");
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
      setAuthError("Your session has expired. Please log in again.");
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);

    // Main refreshes the session itself right before an upload; keep ours in
    // step, or the next launch would refresh with a superseded token.
    const offSessionRefreshed = window.electronAPI?.auth?.onSessionRefreshed?.((session) => {
      if (AuthService.getSession()) AuthService.saveSession(session);
    });

    // Uploads and links run in main, outside the api bridge that raises
    // `auth:unauthorized`; main reports their 401s here instead.
    const offUnauthorized = window.electronAPI?.auth?.onUnauthorized?.((detail) =>
      window.dispatchEvent(
        new CustomEvent("auth:unauthorized", {
          detail: { status: 401, statusText: "Unauthorized", message: detail.message },
        })
      )
    );

    return () => {
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
      offSessionRefreshed?.();
      offUnauthorized?.();
    };
  }, []);


  const handleLogin = async (email: string, password: string) => {
    setIsAuthenticating(true);
    setAuthError("");

    try {
      const { user: loggedInUser } = await AuthService.login(email, password);
      setUser(loggedInUser);
      setAuthState("authenticated");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Login failed";
      setAuthError(errorMessage);
      setAuthState("error");
    } finally {
      setIsAuthenticating(false);
    }
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
          error={authError}
        />
        <ErrorToastContainer errors={errors} onDismiss={removeError} />
      </>
    );
  }

  // Show interactive login if authenticated
  return (
    <>
      <div className="flex min-h-screen flex-col bg-background">
        <UserHeader user={user} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
        <main className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4">
          <InteractiveLoginFlow
            accessToken={AuthService.getSession()?.accessToken || ""}
            userId={user?.id || ""}
          />
        </main>

        <footer className="border-t border-border bg-card px-6 py-6 text-center">
          <p className="text-xs font-normal text-muted-foreground">
            Browser profiles are compressed and uploaded to S3 for secure storage
          </p>
        </footer>
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
