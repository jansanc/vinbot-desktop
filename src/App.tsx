import { useState, useEffect } from "react";
import ExtractionForm from "./components/ExtractionForm";
import ProfileUploadFlow from "./components/ProfileUploadFlow";
import InteractiveLoginFlow from "./components/InteractiveLoginFlow";
import ProgressDisplay from "./components/ProgressDisplay";
import ResultsDisplay from "./components/ResultsDisplay";
import LoginForm from "./components/LoginForm";
import UserProfile from "./components/UserProfile";
import UserHeader from "./components/UserHeader";
import { ExtractionState, ExtractionData, AuthState, ProfileInfo } from "./types";
import { AuthService, AuthUser } from "./services/auth.service";
import { UnauthorizedError } from "./services/api.service";
import { config } from "./config/config";
import { parseError, logError } from "./utils/error-handler";

type AppMode = "extract" | "upload" | "interactive";

function App() {
  const [authState, setAuthState] = useState<AuthState>("unauthenticated");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string>("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [appMode, setAppMode] = useState<AppMode>("extract");
  const [state, setState] = useState<ExtractionState>("idle");
  const [extractionData, setExtractionData] = useState<ExtractionData | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [selectedBrowser, setSelectedBrowser] = useState<"chrome" | "firefox" | "edge">("chrome");
  const [firefoxProfiles, setFirefoxProfiles] = useState<ProfileInfo[]>([]);
  const [chromeProfiles, setChromeProfiles] = useState<ProfileInfo[]>([]);
  const [edgeProfiles, setEdgeProfiles] = useState<ProfileInfo[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    const existingUser = AuthService.getUser();
    const existingSession = AuthService.getSession();

    if (existingUser && existingSession && AuthService.isSessionValid()) {
      setUser(existingUser);
      setAuthState("authenticated");
    } else {
      AuthService.clearSession();
    }

    // Load profiles for all browsers on mount
    loadAllBrowserProfiles();

    // Listen for unauthorized (401) errors
    const handleUnauthorized = async (event: Event) => {
      const customEvent = event as CustomEvent;
      console.warn("Session expired or unauthorized:", customEvent.detail);

      // Clear session immediately
      AuthService.clearSession();
      setUser(null);
      setAuthState("unauthenticated");
      setAuthError("Your session has expired. Please log in again.");
      setError("");
      setState("idle");
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);

    return () => {
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
    };
  }, []);

  const loadAllBrowserProfiles = async () => {
    setLoadingProfiles(true);
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        console.warn(
          "⚠️  Electron API not available. Make sure you're running through Electron, not browser directly."
        );
        console.warn("💡 Run: npm start (not npm run react-start)");
        setError(
          "App must run through Electron. Run 'npm start' instead of opening in browser."
        );
        setLoadingProfiles(false);
        return;
      }

      const [firefox, chrome, edge] = await Promise.all([
        electronAPI.getFirefoxProfiles().catch(() => []),
        electronAPI.getChromeProfiles().catch(() => []),
        electronAPI.getEdgeProfiles().catch(() => []),
      ]);

      setFirefoxProfiles(firefox);
      setChromeProfiles(chrome);
      setEdgeProfiles(edge);
    } catch (err) {
      console.error("Failed to load browser profiles:", err);
      setError("Failed to load browser profiles");
    } finally {
      setLoadingProfiles(false);
    }
  };

  const handleExtraction = async (formData: {
    browser: "firefox" | "chrome" | "edge";
    profile?: string;
    vintedEmail: string;
    userEmail: string;
    vintedMemberId: string;
    vintedBaseUrl: string;
  }) => {
    try {
      setSelectedBrowser(formData.browser);
      setState("extracting");
      setError("");

      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        throw new Error("Electron API not available");
      }

      const data = await electronAPI.extractVintedSession({
        browser: formData.browser,
        profile: formData.profile || "",
        vintedBaseUrl: formData.vintedBaseUrl,
      });

      console.log("Electron API extracted data:", {
        keys: Object.keys(data),
        data: data,
      });

      setExtractionData(data);

      setState("saving");
      const session = AuthService.getSession();
      if (!session) {
        throw new Error("Session not found. Please log in again.");
      }

      const { ApiService } = await import("./services/api.service");
      const result = await ApiService.storeDesktopSession(session.accessToken, {
        vintedEmail: formData.vintedEmail,
        browserFingerprint: data.fingerprint,
        sessionData: data.authentication.cookies,
        sessionOrigins: data.authentication.origins,
      });

      setState("complete");
    } catch (err) {
      const appError = parseError(err);
      logError(err, "Session Extraction");

      // Handle authentication errors
      if (appError.shouldRedirectToLogin) {
        AuthService.clearSession();
        setUser(null);
        setAuthState("unauthenticated");
        setAuthError("Your session has expired. Please log in again.");
        setError("");
        setState("idle");
        return;
      }

      setError(appError.message);
      setState("error");
    }
  };

  const handleReset = () => {
    setState("idle");
    setExtractionData(null);
    setError("");
  };

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
      <LoginForm
        onSubmit={handleLogin}
        isLoading={isAuthenticating}
        error={authError}
      />
    );
  }

  // Show user profile and extraction tools if authenticated
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <UserHeader user={user} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
      <main className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 ">
        {/* Mode Tabs */}
        {state === "idle" && (
          <div className="mb-6 flex gap-4 border-b">
            <button
              onClick={() => setAppMode("extract")}
              className={`px-6 py-3 font-semibold transition-colors ${
                appMode === "extract"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Extract Session
            </button>
            <button
              onClick={() => setAppMode("interactive")}
              className={`px-6 py-3 font-semibold transition-colors ${
                appMode === "interactive"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Interactive Login
            </button>
            <button
              onClick={() => setAppMode("upload")}
              className={`px-6 py-3 font-semibold transition-colors ${
                appMode === "upload"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Upload Profiles to S3
            </button>
          </div>
        )}

        {state === "idle" && appMode === "extract" && (
          <ExtractionForm
            onSubmit={handleExtraction}
            firefoxProfiles={firefoxProfiles}
            chromeProfiles={chromeProfiles}
            edgeProfiles={edgeProfiles}
            loadingProfiles={loadingProfiles}
          />
        )}

        {state === "idle" && appMode === "interactive" && (
          <InteractiveLoginFlow
            accessToken={AuthService.getSession()?.accessToken || ""}
            userId={user?.id || ""}
          />
        )}

        {state === "idle" && appMode === "upload" && (
          <ProfileUploadFlow
            chromeProfiles={chromeProfiles}
            firefoxProfiles={firefoxProfiles}
            edgeProfiles={edgeProfiles}
            accessToken={AuthService.getSession()?.accessToken || ""}
            vintedAccountId={user?.id || ""}
            userId={user?.id || ""}
            onUploadComplete={(results) => {
              console.log("Upload complete:", results);
            }}
          />
        )}

        {(state === "extracting" || state === "saving") && (
          <ProgressDisplay stage={state} browser={selectedBrowser} />
        )}

        {state === "complete" && extractionData && (
          <ResultsDisplay onReset={handleReset} extractionData={extractionData} />
        )}

        {state === "error" && (
          <div className="mx-auto w-full max-w-md">
            <div className="relative overflow-hidden rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center shadow-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-destructive/10 to-destructive/5" />
              <div className="relative">
                <h2 className="mb-3 text-xl font-semibold text-destructive">
                  Extraction Failed
                </h2>
                <p className="mb-6 text-sm leading-relaxed text-destructive/80">
                  {error}
                </p>
                <button
                  onClick={handleReset}
                  className="group relative inline-block overflow-hidden rounded-lg bg-primary px-6 py-2 text-base font-semibold text-primary-foreground transition-all duration-200 shadow-sm hover:shadow-md hover:bg-primary/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
                >
                  <div className="absolute inset-0 -translate-x-full bg-white/10 transition-transform duration-300 group-hover:translate-x-full" />
                  <span className="relative">Try Again</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border bg-card px-6 py-6 text-center">
        <p className="text-xs font-normal text-muted-foreground">
          Your data is extracted locally and never shared without your consent
        </p>
      </footer>
    </div>
  );
}

export default App;
