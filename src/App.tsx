import { useState, useEffect } from "react";
import "./App.css";
import ExtractionForm from "./components/ExtractionForm";
import ProgressDisplay from "./components/ProgressDisplay";
import ResultsDisplay from "./components/ResultsDisplay";
import { ExtractionState, ExtractionData } from "./types";

function App() {
  const [state, setState] = useState<ExtractionState>("idle");
  const [extractionData, setExtractionData] = useState<ExtractionData | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [firefoxProfiles, setFirefoxProfiles] = useState<string[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  useEffect(() => {
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

  return (
    <div className="App">
      <header className="app-header">
        <h1>🔐 Vinted Session Authenticator</h1>
        <p>Extract and manage your Vinted authentication data securely</p>
      </header>

      <main className="app-main">
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
