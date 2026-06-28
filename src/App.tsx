import { useState, useEffect } from "react";
import "./App.css";
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
  const [firefoxProfiles, setFirefoxProfiles] = useState<string[]>([]);
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

    // Load Firefox profiles on mount
    loadProfilesForBrowser("firefox");
  }, []);

  const loadProfilesForBrowser = async (browser: "firefox" | "chrome" | "edge") => {
    setLoadingProfiles(true);
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        throw new Error("Electron API not available");
      }

      let profiles: string[] = [];
      if (browser === "firefox") {
        profiles = await electronAPI.getFirefoxProfiles();
      } else if (browser === "chrome") {
        profiles = await electronAPI.getChromeProfiles();
      } else if (browser === "edge") {
        profiles = await electronAPI.getEdgeProfiles();
      }

      setFirefoxProfiles(profiles);
    } catch (err) {
      console.error(`Failed to load ${browser} profiles:`, err);
      setError(`Failed to load ${browser} profiles`);
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
    saveMethod: "file";
    vintedBaseUrl: string;
  }) => {
    try {
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
      await electronAPI.saveExtraction(data, "file", {
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
      const errorMessage =
        err instanceof Error ? err.message : "Login failed";
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
    <div className="App">
      <header className="app-header">
        <h1>🔐 Vinted Session Authenticator</h1>
        <p>Extract and manage your Vinted authentication data securely</p>
      </header>

      <main className="app-main">
        <UserProfile
          user={user}
          onLogout={handleLogout}
          isLoggingOut={isLoggingOut}
        />

        {state === "idle" && (
          <ExtractionForm
            onSubmit={handleExtraction}
            firefoxProfiles={firefoxProfiles}
            loadingProfiles={loadingProfiles}
          />
        )}

        {(state === "extracting" || state === "saving") && (
          <ProgressDisplay stage={state} />
        )}

        {state === "complete" && extractionData && (
          <ResultsDisplay data={extractionData} onReset={handleReset} />
        )}

        {state === "error" && (
          <div className="error-container">
            <div className="error-box">
              <h2>❌ Error During Extraction</h2>
              <p className="error-message">{error}</p>
              <button className="btn btn-primary" onClick={handleReset}>
                Try Again
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Your data is extracted locally and never shared without your consent
        </p>
      </footer>
    </div>
  );
}

export default App;
