import { useState, useEffect } from "react";
import ExtractionForm from "./components/ExtractionForm";
import ProgressDisplay from "./components/ProgressDisplay";
import ResultsDisplay from "./components/ResultsDisplay";
import LoginForm from "./components/LoginForm";
import UserProfile from "./components/UserProfile";
import { ExtractionState, ExtractionData, AuthState } from "./types";
import { AuthService, AuthUser } from "./services/auth.service";

function App() {
  const [authState, setAuthState] = useState<AuthState>("unauthenticated");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string>("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [state, setState] = useState<ExtractionState>("idle");
  const [extractionData, setExtractionData] = useState<ExtractionData | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [selectedBrowser, setSelectedBrowser] = useState<"chrome" | "firefox" | "edge">("chrome");
  const [firefoxProfiles, setFirefoxProfiles] = useState<string[]>([]);
  const [chromeProfiles, setChromeProfiles] = useState<string[]>([]);
  const [edgeProfiles, setEdgeProfiles] = useState<string[]>([]);
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

      setExtractionData(data);

      setState("saving");
      await electronAPI.saveExtraction(data, "database", {
        vintedEmail: formData.vintedEmail,
        userEmail: formData.userEmail,
        vintedMemberId: formData.vintedMemberId,
      });

      setState("complete");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setState("error");
      console.error("Extraction failed:", err);
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
      <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 ">
        {state === "idle" && (
          <ExtractionForm
            onSubmit={handleExtraction}
            firefoxProfiles={firefoxProfiles}
            chromeProfiles={chromeProfiles}
            edgeProfiles={edgeProfiles}
            loadingProfiles={loadingProfiles}
          />
        )}

        {(state === "extracting" || state === "saving") && (
          <ProgressDisplay stage={state} browser={selectedBrowser} />
        )}

        {state === "complete" && extractionData && (
          <ResultsDisplay data={extractionData} onReset={handleReset} />
        )}

        {state === "error" && (
          <div className="mx-auto w-full max-w-md">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-8 text-center shadow-sm">
              <h2 className="mb-3 text-xl font-semibold text-destructive">
                ❌ Error During Extraction
              </h2>
              <p className="mb-6 text-sm leading-relaxed text-destructive">
                {error}
              </p>
              <button
                onClick={handleReset}
                className="inline-block rounded-lg border border-transparent bg-primary px-6 py-2 text-base font-semibold text-primary-foreground transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Try Again
              </button>
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
