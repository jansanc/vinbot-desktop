import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle, Loader, Lock, Mail, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import { useError } from "../contexts/ErrorContext";
import { ErrorHandler } from "../utils/errorHandler";

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
  const { addError } = useError();
  const [url, setUrl] = useState("https://www.vinted.es/member/signup/select_type?ref_url=%2F");
  const [profileName, setProfileName] = useState("");
  const [timeout, setTimeout] = useState(5);
  const [userEmail, setUserEmail] = useState(initialUserId);
  const [vintedEmail, setVintedEmail] = useState("");
  const [vintedMemberId, setVintedMemberId] = useState("");
  const [accessToken, setAccessToken] = useState(initialAccessToken);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<LoginProgress[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    const handleProgress = (data: LoginProgress) => {
      console.log("[UI] Progress:", data);

      // Detect error/warning messages from progress events
      const step = data.step.toUpperCase();
      const isError = step.includes("ERROR") || step.includes("FAILED");
      const isWarning = step.includes("WARNING");

      if (isError || isWarning) {
        // Extract clean message (remove emoji prefix and formatting)
        let cleanMsg = data.message
          .replace(/^[⚠️❌🔴📛✋]+\s*/, "") // Remove emoji
          .replace(/^[^:]+:\s*/, ""); // Remove "Step:" prefix

        // Try to extract actual error message if JSON is embedded
        try {
          if (cleanMsg.includes("{") && cleanMsg.includes("}")) {
            const jsonMatch = cleanMsg.match(/\{.*\}/);
            if (jsonMatch) {
              const jsonObj = JSON.parse(jsonMatch[0]);
              if (jsonObj.message) {
                cleanMsg = jsonObj.message;
              }
            }
          }
        } catch (e) {
          // Keep original message if JSON parsing fails
        }

        const progressError = new Error(cleanMsg);
        console.log(`[UI] Progress ${isError ? "error" : "warning"} detected:`, cleanMsg);

        // Mark that an error occurred - this will stop showing progress
        setHasError(true);
        setProgress([]);
        setResult(null);

        addError(progressError, `InteractiveLoginFlow.IPC.${step}`);
      } else if (!hasError) {
        // Only add progress if no error has occurred yet
        setProgress((prev) => [...prev, data]);
      }
    };

    const handleError = (data: { error: string; timestamp: string }) => {
      console.log("[UI] ERROR RECEIVED - Stopping everything:", data);
      const error = new Error(data.error);
      addError(error, "InteractiveLoginFlow.IPC");
      setError(data.error);
      setIsLoading(false);
      setHasError(true);

      // Clear progress when error occurs - show only the error
      setProgress([]);
      setResult(null);

      console.log("[UI] Progress cleared, error-only state activated");
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
    if (!vintedEmail.trim()) {
      const validationError = ErrorHandler.createError(
        "VALIDATION_ERROR",
        "Vinted email is required",
        { field: "vintedEmail" }
      );
      addError(validationError, "InteractiveLoginFlow");
      return;
    }

    setError(null);
    setProgress([]);
    setResult(null);
    setHasError(false);
    setIsLoading(true);

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        throw new Error("Electron API not available");
      }

      // Validate and refresh token if needed
      let currentToken = accessToken.trim();
      if (!currentToken) {
        throw new Error("Session error: Your session may have expired. Please log in again.");
      }

      console.log("[InteractiveLoginFlow] Using access token for login");

      // Auto-generate profile name if not provided
      const finalProfileName = profileName.trim() || `vinted_${Date.now()}`;

      const response = await electronAPI.interactiveLogin({
        url: url.trim(),
        profileName: finalProfileName,
        timeout: timeout * 60, // Convert minutes to seconds
        userEmail: userEmail.trim(),
        vintedEmail: vintedEmail.trim(),
        vintedMemberId: vintedMemberId.trim() || undefined,
        accessToken: currentToken,
        uploadToS3: true,
      });

      if (response.success) {
        setResult(response.session);
      } else {
        const errorMsg = response.message || response.error || "Login failed";
        const err = new Error(errorMsg);
        addError(err, "InteractiveLoginFlow");
        setError(errorMsg);
      }
    } catch (err) {
      addError(err, "InteractiveLoginFlow.handleStartLogin");
      const msg = err instanceof Error ? err.message : String(err);

      // Check if this is a session/auth error
      if (msg.includes("Session error") || msg.includes("access token") || msg.includes("not authenticated")) {
        setError("Your session has expired. Please log in again from the login page.");
      } else {
        setError(`Failed to start: ${msg}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setProgress([]);
    setResult(null);
    setError(null);
    setHasError(false);
    setShowAdvanced(false);
  };

  // Map technical steps to friendly messages
  const getFriendlyMessage = (step: string, originalMessage: string): string => {
    const friendlyMessages: { [key: string]: string } = {
      "START": "Starting login process...",
      "BROWSER_LAUNCH": "Opening browser...",
      "WAITING_FOR_LOGIN": "Waiting for you to log in (close browser when done)...",
      "EXTRACT_COMPLETE": "Session saved successfully!",
      "COMPRESS_START": "Saving your session...",
      "UPLOAD_START": "Uploading to cloud...",
      "UPLOAD_SUCCESS": "Upload complete!",
    };
    return friendlyMessages[step] || originalMessage;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br dark:from-slate-900 dark:to-slate-800 from-gray-50 to-gray-100 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Lock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold dark:text-white text-gray-900">
              Save Your Session
            </h1>
          </div>
          <p className="text-base md:text-lg dark:text-gray-400 text-gray-700 ml-11">
            We'll open Firefox for you to log in. Just close it when done, and your session will be saved automatically.
          </p>
        </div>

        {/* Main Content */}
        {!result ? (
          <Card>
            <CardHeader>
              <CardTitle>Login Setup</CardTitle>
              <CardDescription>
                Configure your Vinted email and optional settings to get started
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Error Alert */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Something went wrong</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Email Input - Main Required Field */}
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span>Your Vinted Email</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={vintedEmail}
                  onChange={(e) => setVintedEmail(e.target.value)}
                  disabled={isLoading}
                  placeholder="your@vinted.email"
                  className="text-base"
                />
                <p className="text-xs dark:text-gray-500 text-gray-600">
                  Used to organize your session in our system.
                </p>
              </div>

              {/* Progress Display */}
              {progress.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 dark:bg-slate-900/50 border border-blue-200 dark:border-blue-900">
                    <Loader className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-blue-900 dark:text-blue-300">
                        {progress[progress.length - 1] && getFriendlyMessage(
                          progress[progress.length - 1].step,
                          progress[progress.length - 1].message
                        )}
                      </p>
                      <div className="mt-2 space-y-1">
                        {progress.slice(0, -1).map((entry, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                            <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
                            <span>{getFriendlyMessage(entry.step, entry.message)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Advanced Options */}
              <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                  />
                  Advanced Options
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-slate-900/30">
                    {/* Timeout Input */}
                    <div className="space-y-2">
                      <Label htmlFor="timeout">Wait Time (minutes)</Label>
                      <Input
                        id="timeout"
                        type="number"
                        value={timeout}
                        onChange={(e) => setTimeout(Math.max(1, parseInt(e.target.value) || 5))}
                        disabled={isLoading}
                        min="1"
                        max="60"
                      />
                      <p className="text-xs text-gray-600 dark:text-gray-500">
                        How long to wait for you to close the browser
                      </p>
                    </div>

                    {/* Profile Name */}
                    <div className="space-y-2">
                      <Label htmlFor="profileName">Session Name (optional)</Label>
                      <Input
                        id="profileName"
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        disabled={isLoading}
                        placeholder="Leave empty for auto-generated name"
                      />
                    </div>
                  </div>
                )}
              </div>
            </CardContent>

            {/* Footer with Button */}
            <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700">
              <Button
                onClick={handleStartLogin}
                disabled={isLoading || !vintedEmail.trim()}
                size="lg"
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>Starting...</span>
                  </>
                ) : (
                  "Start Login"
                )}
              </Button>
            </div>
          </Card>
        ) : (
          /* Success Message */
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="mb-6 flex justify-center">
                <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-700 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <h2 className="text-2xl font-bold dark:text-white text-gray-900 mb-2">
                Session Saved Successfully!
              </h2>
              <p className="dark:text-gray-400 text-gray-700 mb-1 text-center max-w-sm">
                Your Vinted session has been saved and uploaded to the cloud.
              </p>
              <p className="text-sm dark:text-gray-500 text-gray-600 mb-6">
                Session size: {((result.profile_archive_size || 0) / (1024 * 1024)).toFixed(1)} MB
              </p>
              <Button
                onClick={handleReset}
                variant="default"
                size="lg"
              >
                Save Another Session
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default InteractiveLoginFlow;
