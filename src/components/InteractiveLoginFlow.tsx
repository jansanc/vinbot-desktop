import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle, Clock, Cookie, Database } from "lucide-react";

interface LoginProgress {
  step: string;
  message: string;
  timestamp: string;
}

interface InteractiveLoginFlowProps {
  accessToken?: string;
  userId?: string;
}

export const InteractiveLoginFlow: React.FC<InteractiveLoginFlowProps> = ({
  accessToken: initialAccessToken = "",
  userId: initialUserId = "",
}) => {
  const [url, setUrl] = useState("https://www.vinted.es/member/signup/select_type?ref_url=%2F");
  const [profileName, setProfileName] = useState("vinted_default");
  const [browser, setBrowser] = useState<"chrome" | "firefox" | "edge">("chrome");
  const [timeout, setTimeout] = useState(300);
  const [userEmail, setUserEmail] = useState(initialUserId);
  const [vintedEmail, setVintedEmail] = useState("");
  const [vintedMemberId, setVintedMemberId] = useState("");
  const [accessToken, setAccessToken] = useState(initialAccessToken);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<LoginProgress[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    const handleProgress = (data: LoginProgress) => {
      console.log("[UI] Progress:", data);
      setProgress((prev) => [...prev, data]);
    };

    const handleError = (data: { error: string; timestamp: string }) => {
      console.log("[UI] Error:", data);
      setError(data.error);
      setIsLoading(false);
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
    if (!url.trim()) {
      setError("Please enter a login URL");
      return;
    }

    if (!profileName.trim()) {
      setError("Please enter a profile name");
      return;
    }

    if (!vintedEmail.trim()) {
      setError("Vinted email is required for S3 upload");
      return;
    }

    if (!userEmail.trim()) {
      setError("User email is required for S3 upload");
      return;
    }

    if (!accessToken.trim()) {
      setError("Access token is required for S3 upload");
      return;
    }

    setError(null);
    setProgress([]);
    setResult(null);
    setIsLoading(true);

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        throw new Error("Electron API not available");
      }

      const response = await electronAPI.interactiveLogin({
        url: url.trim(),
        profileName: profileName.trim(),
        browser,
        timeout,
        userEmail: userEmail.trim(),
        vintedEmail: vintedEmail.trim(),
        vintedMemberId: vintedMemberId.trim() || undefined,
        accessToken: accessToken.trim(),
        uploadToS3: true,  // Always upload to S3
      });

      if (response.success) {
        setResult(response.session);
      } else {
        setError(response.error || "Login failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to start interactive login: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setProgress([]);
    setResult(null);
    setError(null);
    setUrl("https://www.vinted.es/member/signup/select_type?ref_url=%2F");
    setProfileName("vinted_default");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br dark:from-slate-900 dark:to-slate-800 from-white to-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold dark:text-white text-gray-900 mb-2">
            Interactive Session Login
          </h1>
          <p className="dark:text-gray-400 text-gray-600">
            Open a browser, log in manually, and extract your session
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Configuration Panel */}
          <div className="lg:col-span-1">
            <div className="dark:bg-slate-700 bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold dark:text-white text-gray-900 mb-6">
                Configuration
              </h2>

              <div className="space-y-4">
                {/* URL Input */}
                <div>
                  <label className="block text-sm font-medium dark:text-gray-300 text-gray-700 mb-2">
                    Login URL
                  </label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isLoading}
                    className="w-full px-4 py-2 dark:bg-slate-600 dark:text-white dark:border-slate-500 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    placeholder="https://www.vinted.es/..."
                  />
                  <p className="text-xs dark:text-gray-400 text-gray-500 mt-1">
                    URL to open in the browser for login
                  </p>
                </div>

                {/* Profile Name Input */}
                <div>
                  <label className="block text-sm font-medium dark:text-gray-300 text-gray-700 mb-2">
                    Profile Name
                  </label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    disabled={isLoading}
                    className="w-full px-4 py-2 dark:bg-slate-600 dark:text-white dark:border-slate-500 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    placeholder="Profile name"
                  />
                  <p className="text-xs dark:text-gray-400 text-gray-500 mt-1">
                    Identifier for this session
                  </p>
                </div>

                {/* Browser Select */}
                <div>
                  <label className="block text-sm font-medium dark:text-gray-300 text-gray-700 mb-2">
                    Browser
                  </label>
                  <select
                    value={browser}
                    onChange={(e) => setBrowser(e.target.value as "chrome" | "firefox" | "edge")}
                    disabled={isLoading}
                    className="w-full px-4 py-2 dark:bg-slate-600 dark:text-white dark:border-slate-500 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="chrome">Chrome</option>
                    <option value="firefox">Firefox</option>
                    <option value="edge">Edge</option>
                  </select>
                </div>

                {/* Timeout Input */}
                <div>
                  <label className="block text-sm font-medium dark:text-gray-300 text-gray-700 mb-2">
                    Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={timeout}
                    onChange={(e) => setTimeout(Math.max(30, parseInt(e.target.value) || 300))}
                    disabled={isLoading}
                    min="30"
                    max="3600"
                    className="w-full px-4 py-2 dark:bg-slate-600 dark:text-white dark:border-slate-500 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <p className="text-xs dark:text-gray-400 text-gray-500 mt-1">
                    How long to wait for browser to close ({timeout}s = {(timeout / 60).toFixed(1)}m)
                  </p>
                </div>

                {/* S3 Upload Details */}
                <div className="pt-4 border-t border-gray-300 dark:border-slate-600">
                  <h3 className="font-semibold dark:text-white text-gray-900 mb-3">S3 Upload Details</h3>

                  {/* Vinted Email - Required */}
                  <div className="mb-3">
                    <label className="block text-sm font-medium dark:text-gray-300 text-gray-700 mb-2">
                      Vinted Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={vintedEmail}
                      onChange={(e) => setVintedEmail(e.target.value)}
                      disabled={isLoading}
                      placeholder="your@vinted.email"
                      className="w-full px-3 py-2 text-xs dark:bg-slate-600 dark:text-white dark:border-slate-500 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <p className="text-xs dark:text-gray-400 text-gray-500 mt-1">
                      Used as part of S3 storage path
                    </p>
                  </div>

                  {/* Vinted Member ID - Optional */}
                  <div>
                    <label className="block text-sm font-medium dark:text-gray-300 text-gray-700 mb-2">
                      Vinted Member ID <span className="text-gray-500">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={vintedMemberId}
                      onChange={(e) => setVintedMemberId(e.target.value)}
                      disabled={isLoading}
                      placeholder="e.g., 123456"
                      className="w-full px-3 py-2 text-xs dark:bg-slate-600 dark:text-white dark:border-slate-500 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-4">
                  <button
                    onClick={handleStartLogin}
                    disabled={isLoading}
                    className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
                  >
                    {isLoading ? "Login in Progress..." : "Start Login"}
                  </button>

                  {(result || error) && (
                    <button
                      onClick={handleReset}
                      disabled={isLoading}
                      className="w-full px-6 py-2 dark:bg-slate-600 dark:hover:bg-slate-500 bg-gray-200 hover:bg-gray-300 text-gray-900 dark:text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Instructions */}
                <div className="mt-6 p-4 dark:bg-slate-600 bg-blue-50 border border-blue-200 dark:border-slate-500 rounded-lg">
                  <h3 className="font-semibold text-sm dark:text-blue-300 text-blue-900 mb-2">
                    Workflow:
                  </h3>
                  <ol className="text-xs dark:text-gray-300 text-gray-700 space-y-1">
                    <li>1. Fill in Vinted Email (required)</li>
                    <li>2. Click "Start Login"</li>
                    <li>3. Browser opens with the URL</li>
                    <li>4. Log in manually in the browser</li>
                    <li>5. Close the browser when done</li>
                    <li>6. Profile compressed to tar.gz</li>
                    <li>7. Automatically uploaded to S3</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>

          {/* Progress & Results Panel */}
          <div className="lg:col-span-2">
            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 dark:bg-red-900/30 dark:border-red-700 bg-red-50 border border-red-200 rounded-lg flex gap-3">
                <AlertCircle className="w-5 h-5 dark:text-red-400 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold dark:text-red-300 text-red-900">Error</p>
                  <p className="text-sm dark:text-red-200 text-red-700 mt-1">{error}</p>
                </div>
              </div>
            )}

            {/* Progress Log */}
            {progress.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xl font-semibold dark:text-white text-gray-900 mb-4">
                  Progress Log
                </h2>
                <div className="dark:bg-slate-700 bg-white rounded-lg shadow-md p-6 max-h-96 overflow-y-auto">
                  <div className="space-y-3">
                    {progress.map((entry, idx) => (
                      <div key={idx} className="flex gap-3">
                        <div className="w-5 h-5 rounded-full dark:bg-blue-600 bg-blue-500 flex-shrink-0 mt-0.5 flex items-center justify-center">
                          {entry.step === "START" || entry.step === "EXTRACT_COMPLETE" ? (
                            <CheckCircle className="w-4 h-4 text-white" />
                          ) : (
                            <Clock className="w-3 h-3 text-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-xs dark:text-gray-400 text-gray-500">
                            {entry.timestamp}
                          </p>
                          <p className="text-sm dark:text-gray-200 text-gray-800 break-words">
                            <span className="font-semibold dark:text-blue-400 text-blue-600">[{entry.step}]</span>{" "}
                            {entry.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            {result && (
              <div>
                <h2 className="text-xl font-semibold dark:text-white text-gray-900 mb-4">
                  Extraction Results
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  {/* Profile Archive Card */}
                  <div className="dark:bg-slate-700 bg-white rounded-lg shadow-md p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <Database className="w-6 h-6 dark:text-blue-400 text-blue-600" />
                      <h3 className="font-semibold dark:text-white text-gray-900">Profile Archive</h3>
                    </div>
                    <p className="text-3xl font-bold dark:text-blue-400 text-blue-600">
                      {((result.profile_archive_size || 0) / (1024 * 1024)).toFixed(2)}
                    </p>
                    <p className="text-sm dark:text-gray-400 text-gray-600 mt-2">
                      MB (tar.gz compressed)
                    </p>
                  </div>

                  {/* Complete Profile Card */}
                  <div className="dark:bg-slate-700 bg-white rounded-lg shadow-md p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <Cookie className="w-6 h-6 dark:text-green-400 text-green-600" />
                      <h3 className="font-semibold dark:text-white text-gray-900">Complete Profile</h3>
                    </div>
                    <p className="text-lg font-bold dark:text-green-400 text-green-600">
                      ✅ Saved
                    </p>
                    <p className="text-sm dark:text-gray-400 text-gray-600 mt-2">
                      All cookies, cache, history included
                    </p>
                  </div>
                </div>

                {/* Session Details */}
                <div className="mt-4 dark:bg-slate-700 bg-white rounded-lg shadow-md p-6">
                  <h3 className="font-semibold dark:text-white text-gray-900 mb-4">Profile Details</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="dark:text-gray-400 text-gray-600">Profile Name:</span>
                      <span className="dark:text-gray-200 text-gray-900 font-mono">
                        {result.profile_name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dark:text-gray-400 text-gray-600">Login URL:</span>
                      <span className="dark:text-gray-200 text-gray-900 font-mono truncate text-xs">
                        {result.url}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dark:text-gray-400 text-gray-600">Archive Path:</span>
                      <span className="dark:text-gray-200 text-gray-900 font-mono truncate text-xs">
                        {result.profile_archive_path?.split("\\").pop() || "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dark:text-gray-400 text-gray-600">Archive Size:</span>
                      <span className="dark:text-gray-200 text-gray-900 font-mono">
                        {((result.profile_archive_size || 0) / (1024 * 1024)).toFixed(2)}MB
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dark:text-gray-400 text-gray-600">Login Duration:</span>
                      <span className="dark:text-gray-200 text-gray-900 font-mono">
                        {(result.loginDuration / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="dark:text-gray-400 text-gray-600">Compressed At:</span>
                      <span className="dark:text-gray-200 text-gray-900 font-mono text-xs">
                        {new Date(result.compressed_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InteractiveLoginFlow;
