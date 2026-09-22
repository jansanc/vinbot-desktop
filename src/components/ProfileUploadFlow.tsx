import React, { useState, useEffect } from "react";
import { ProfileInfo } from "../types";

interface ProfileUploadFlowProps {
  chromeProfiles: ProfileInfo[];
  firefoxProfiles: ProfileInfo[];
  edgeProfiles: ProfileInfo[];
  accessToken: string;
  vintedAccountId: string;
  userId: string;
  onUploadComplete?: (results: any) => void;
}

interface SelectedProfiles {
  chrome: Set<string>;
  firefox: Set<string>;
  edge: Set<string>;
}

interface UploadProgress {
  current: number;
  total: number;
  profileName: string;
  status: "uploading" | "success" | "error";
  message?: string;
}

interface ProgressLog {
  step: string;
  message: string;
  timestamp: string;
}

const ProfileUploadFlow: React.FC<ProfileUploadFlowProps> = ({
  chromeProfiles,
  firefoxProfiles,
  edgeProfiles,
  accessToken,
  vintedAccountId,
  userId,
  onUploadComplete,
}) => {
  const [selectedProfiles, setSelectedProfiles] = useState<SelectedProfiles>({
    chrome: new Set(),
    firefox: new Set(),
    edge: new Set(),
  });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadResults, setUploadResults] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [vintedEmail, setVintedEmail] = useState<string>("");

  useEffect(() => {
    // Listen for batch upload progress events
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.onBatchUploadProgress) {
      return;
    }

    try {
      const unsubscribe = electronAPI.onBatchUploadProgress((data: any) => {
        setUploadProgress({
          current: data.current,
          total: data.total,
          profileName: data.profileName,
          status: data.profileName ? "uploading" : "error",
        });
      });

      return () => {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      };
    } catch (error) {
      console.error("Failed to setup batch upload progress listener:", error);
      return;
    }
  }, []);

  useEffect(() => {
    // Listen for progress log events
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      return;
    }

    const handleProgressLog = (log: ProgressLog) => {
      setProgressLogs((prev) => [...prev, log]);
    };

    // Note: This is a simplified approach. In a real app, you'd use ipcRenderer.on
    // For now, we'll just capture console logs
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      originalLog(...args);
      const message = args.join(" ");
      if (message.includes("[IPC]")) {
        setProgressLogs((prev) => [
          ...prev,
          {
            step: message.split("[IPC]")[1]?.trim().split(":")[0] || "LOG",
            message: message,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    };

    return () => {
      console.log = originalLog;
    };
  }, []);

  const toggleProfileSelection = (
    browser: "chrome" | "firefox" | "edge",
    profileId: string
  ) => {
    setSelectedProfiles((prev) => {
      const newSelected = new Set(prev[browser]);
      if (newSelected.has(profileId)) {
        newSelected.delete(profileId);
      } else {
        newSelected.add(profileId);
      }
      return { ...prev, [browser]: newSelected };
    });
  };

  const selectAllBrowser = (browser: "chrome" | "firefox" | "edge") => {
    const profiles = {
      chrome: chromeProfiles,
      firefox: firefoxProfiles,
      edge: edgeProfiles,
    }[browser];

    setSelectedProfiles((prev) => ({
      ...prev,
      [browser]: new Set(profiles.map((p) => p.id)),
    }));
  };

  const deselectAllBrowser = (browser: "chrome" | "firefox" | "edge") => {
    setSelectedProfiles((prev) => ({
      ...prev,
      [browser]: new Set(),
    }));
  };

  const getTotalSelected = (): number => {
    return (
      selectedProfiles.chrome.size +
      selectedProfiles.firefox.size +
      selectedProfiles.edge.size
    );
  };

  const handleUpload = async () => {
    try {
      setError("");
      setUploadResults(null);
      setProgressLogs([]);

      if (getTotalSelected() === 0) {
        setError("Please select at least one profile to upload");
        return;
      }

      if (!vintedEmail.trim()) {
        setError("Please enter your Vinted email address");
        return;
      }

      setIsUploading(true);

      // Collect all selected profiles
      // Note: Profile paths should come from the main process (ipcHandlers)
      // which has access to system paths like APPDATA
      const profilesToUpload = [
        ...chromeProfiles
          .filter((p) => selectedProfiles.chrome.has(p.id))
          .map((p) => {
            // For Chrome, we need to construct the full path
            // The main process will handle this in the IPC handler
            return {
              id: p.id,
              name: `Chrome - ${p.name}`,
              path: p.path || p.id, // Let the main process construct the full path
              browser: "chrome" as const,
            };
          }),
        ...firefoxProfiles
          .filter((p) => selectedProfiles.firefox.has(p.id))
          .map((p) => {
            return {
              id: p.id,
              name: `Firefox - ${p.name}`,
              path: p.path || p.id,
              browser: "firefox" as const,
            };
          }),
        ...edgeProfiles
          .filter((p) => selectedProfiles.edge.has(p.id))
          .map((p) => {
            return {
              id: p.id,
              name: `Edge - ${p.name}`,
              path: p.path || p.id,
              browser: "edge" as const,
            };
          }),
      ];

      console.log(`Starting batch upload of ${profilesToUpload.length} profiles`);

      const electronAPI = (window as any).electronAPI;
      const result = await electronAPI.batchUploadProfiles({
        profiles: profilesToUpload,
        accessToken,
        vintedAccountId,
        userId,
        vintedEmail: vintedEmail.trim(),
      });

      if (result.success) {
        setUploadResults(result);
        onUploadComplete?.(result);
        setSelectedProfiles({
          chrome: new Set(),
          firefox: new Set(),
          edge: new Set(),
        });
        setVintedEmail("");
      } else {
        setError(result.error || "Upload failed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Upload error:", message);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const BrowserSection = ({
    browser,
    profiles,
    title,
    icon,
  }: {
    browser: "chrome" | "firefox" | "edge";
    profiles: ProfileInfo[];
    title: string;
    icon: string;
  }) => {
    const selected = selectedProfiles[browser];

    return (
      <div className="browser-section" style={{
        border: `1px solid hsl(var(--border))`,
        borderRadius: '0.5rem',
        padding: '1rem',
        marginBottom: '1rem',
        backgroundColor: `hsl(var(--card))`,
      }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{icon}</span>
            <h3 className="font-semibold text-lg" style={{ color: `hsl(var(--foreground))` }}>{title}</h3>
            <span className="text-sm" style={{ color: `hsl(var(--muted-foreground))` }}>
              ({selected.size}/{profiles.length})
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => selectAllBrowser(browser)}
              className="browser-action-btn browser-action-btn--primary"
              disabled={isUploading || profiles.length === 0}
            >
              Select All
            </button>
            <button
              onClick={() => deselectAllBrowser(browser)}
              className="browser-action-btn browser-action-btn--secondary"
              disabled={isUploading}
            >
              Clear
            </button>
          </div>
        </div>

        {profiles.length === 0 ? (
          <p className="text-sm" style={{ color: `hsl(var(--muted-foreground))` }}>No profiles found</p>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {profiles.map((profile) => (
              <label
                key={profile.id}
                className="profile-checkbox-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: `hsl(var(--muted) / 0.3)`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = `hsl(var(--muted) / 0.6)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = `hsl(var(--muted) / 0.3)`;
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(profile.id)}
                  onChange={() => toggleProfileSelection(browser, profile.id)}
                  disabled={isUploading}
                  className="w-4 h-4"
                />
                <span className="flex-1 text-sm" style={{ color: `hsl(var(--foreground))` }}>{profile.name || profile.id}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6" style={{ backgroundColor: `hsl(var(--background))`, minHeight: '100vh' }}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2" style={{ color: `hsl(var(--foreground))` }}>Upload Profiles</h2>
        <p style={{ color: `hsl(var(--muted-foreground))` }}>
          Select browser profiles to upload securely through the backend
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-display" style={{
          marginBottom: '1rem',
          padding: '1rem',
          borderRadius: '0.5rem',
          border: `1px solid hsl(var(--destructive))`,
          backgroundColor: `hsl(var(--destructive) / 0.1)`,
          transition: 'all 0.2s ease',
        }}>
          <p className="text-sm" style={{ color: `hsl(var(--destructive))`, fontWeight: '500' }}>
            ⚠️ {error}
          </p>
        </div>
      )}

      {/* Vinted Email Input */}
      {!uploadResults && (
        <div className="vinted-email-section" style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          borderRadius: '0.5rem',
          border: `1px solid hsl(var(--border))`,
          backgroundColor: `hsl(var(--card))`,
        }}>
          <label className="block text-sm font-medium mb-2" style={{ color: `hsl(var(--foreground))` }}>
            Vinted Email Address *
          </label>
          <input
            type="email"
            value={vintedEmail}
            onChange={(e) => setVintedEmail(e.target.value)}
            placeholder="your.vinted.email@example.com"
            disabled={isUploading}
            className="vinted-email-input"
            style={{
              width: '100%',
              padding: '0.75rem',
              border: `1px solid hsl(var(--border))`,
              borderRadius: '0.375rem',
              backgroundColor: `hsl(var(--background))`,
              color: `hsl(var(--foreground))`,
              fontSize: '0.875rem',
              transition: 'all 0.2s ease',
              outline: 'none',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = `hsl(var(--ring))`;
              e.currentTarget.style.boxShadow = `0 0 0 3px hsl(var(--ring) / 0.1)`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = `hsl(var(--border))`;
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <p className="text-xs mt-1" style={{ color: `hsl(var(--muted-foreground))` }}>
            Enter the email address associated with your Vinted account
          </p>
        </div>
      )}

      {/* Browser Selection */}
      {!uploadResults && (
        <>
          <div className="mb-6 space-y-4">
            <BrowserSection
              browser="firefox"
              profiles={firefoxProfiles}
              title="Mozilla Firefox"
              icon="🦊"
            />
            <BrowserSection
              browser="chrome"
              profiles={chromeProfiles}
              title="Google Chrome"
              icon="🌐"
            />
            <BrowserSection
              browser="edge"
              profiles={edgeProfiles}
              title="Microsoft Edge"
              icon="⬤"
            />
          </div>

          {/* Upload Button */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={handleUpload}
              disabled={isUploading || getTotalSelected() === 0}
              className="upload-button"
              style={{
                flex: 1,
                padding: '0.75rem 1rem',
                fontSize: '1rem',
                fontWeight: '600',
                borderRadius: '0.5rem',
                border: 'none',
                cursor: isUploading || getTotalSelected() === 0 ? 'not-allowed' : 'pointer',
                background: isUploading || getTotalSelected() === 0
                  ? `hsl(var(--muted))`
                  : `linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))`,
                color: isUploading || getTotalSelected() === 0
                  ? `hsl(var(--muted-foreground))`
                  : `hsl(var(--primary-foreground))`,
                opacity: isUploading || getTotalSelected() === 0 ? 0.6 : 1,
                transition: 'all 0.2s ease',
                boxShadow: isUploading || getTotalSelected() === 0
                  ? 'none'
                  : `0 4px 12px hsl(var(--primary) / 0.3)`,
              }}
              onMouseEnter={(e) => {
                if (!isUploading && getTotalSelected() > 0) {
                                    e.currentTarget.style.boxShadow = `0 8px 16px hsl(var(--primary) / 0.4)`;
                }
              }}
              onMouseLeave={(e) => {
                if (!isUploading && getTotalSelected() > 0) {
                                    e.currentTarget.style.boxShadow = `0 4px 12px hsl(var(--primary) / 0.3)`;
                }
              }}
            >
              {isUploading ? (
                <span className="flex items-center justify-center gap-2">
                  <span>⟳</span>
                  Uploading...
                </span>
              ) : (
                `Upload ${getTotalSelected()} Profile${getTotalSelected() !== 1 ? "s" : ""}`
              )}
            </button>
          </div>
        </>
      )}

      {/* Upload Progress */}
      {isUploading && uploadProgress && (
        <div className="mb-6 space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">
                Uploading: {uploadProgress.profileName}
              </span>
              <span className="text-sm text-gray-600">
                {uploadProgress.current} / {uploadProgress.total}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full"
                style={{
                  width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Progress Logs */}
          {progressLogs.length > 0 && (
            <div className="progress-logs" style={{
              padding: '1rem',
              backgroundColor: `hsl(var(--card))`,
              border: `1px solid hsl(var(--border))`,
              borderRadius: '0.5rem',
            }}>
              <div className="text-xs font-semibold mb-2" style={{ color: `hsl(var(--foreground))` }}>Progress Logs:</div>
              <div style={{
                backgroundColor: '#1a1a1a',
                color: '#22c55e',
                borderRadius: '0.375rem',
                padding: '0.75rem',
                fontFamily: '"Menlo", "Monaco", monospace',
                fontSize: '0.75rem',
                maxHeight: '12rem',
                overflowY: 'auto',
                border: `1px solid hsl(var(--border))`,
              }}>
                {progressLogs.map((log, idx) => (
                  <div key={idx} className="mb-1">
                    <span style={{ color: '#3b82f6' }}>[{log.step}]</span>{" "}
                    <span>{log.message.replace("[IPC]", "").trim()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Results */}
      {uploadResults && (
        <div className="mb-6">
          <div style={{
            padding: '1rem',
            backgroundColor: `hsl(var(--success) / 0.1)`,
            border: `1px solid hsl(var(--success))`,
            borderRadius: '0.5rem',
            marginBottom: '1rem',
          }}>
            <h3 className="font-semibold mb-3" style={{ color: `hsl(var(--success))` }}>✓ Upload Complete</h3>
            <div className="grid grid-cols-3 gap-4 text-center mb-4">
              <div>
                <div className="text-2xl font-bold" style={{ color: `hsl(var(--success))` }}>
                  {uploadResults.summary.successful}
                </div>
                <div className="text-xs" style={{ color: `hsl(var(--muted-foreground))` }}>Successful</div>
              </div>
              <div>
                <div className="text-2xl font-bold" style={{ color: `hsl(var(--destructive))` }}>
                  {uploadResults.summary.failed}
                </div>
                <div className="text-xs" style={{ color: `hsl(var(--muted-foreground))` }}>Failed</div>
              </div>
              <div>
                <div className="text-2xl font-bold" style={{ color: `hsl(var(--info))` }}>
                  {uploadResults.summary.total}
                </div>
                <div className="text-xs" style={{ color: `hsl(var(--muted-foreground))` }}>Total</div>
              </div>
            </div>
          </div>

          {/* Detailed Results */}
          <div className="space-y-2 mb-6">
            {uploadResults.results.map((result: any, idx: number) => (
              <div
                key={idx}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.375rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: result.success
                    ? `hsl(var(--success) / 0.1)`
                    : `hsl(var(--destructive) / 0.1)`,
                  border: `1px solid ${result.success ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}`,
                  transition: 'all 0.2s ease',
                }}
              >
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ color: `hsl(var(--foreground))` }}>{result.profileName}</div>
                  {result.error && (
                    <div className="text-xs" style={{ color: `hsl(var(--destructive))` }}>{result.error}</div>
                  )}
                  {result.compressedSize && (
                    <div className="text-xs" style={{ color: `hsl(var(--muted-foreground))` }}>
                      {(result.compressedSize / 1024 / 1024).toFixed(2)} MB
                    </div>
                  )}
                </div>
                <span className="text-xl" style={{ color: result.success ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
                  {result.success ? "✓" : "✗"}
                </span>
              </div>
            ))}
          </div>

          {/* Reset Button */}
          <button
            onClick={() => {
              setUploadResults(null);
              setError("");
            }}
            className="reset-button"
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              backgroundColor: `hsl(var(--secondary))`,
              color: `hsl(var(--secondary-foreground))`,
              fontWeight: '600',
              borderRadius: '0.5rem',
              border: `1px solid hsl(var(--border))`,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = `hsl(var(--secondary) / 0.8)`;
                            e.currentTarget.style.boxShadow = `0 4px 12px rgba(0, 0, 0, 0.1)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = `hsl(var(--secondary))`;
                            e.currentTarget.style.boxShadow = 'none';
            }}
          >
            Upload More Profiles
          </button>
        </div>
      )}
    </div>
  );
};

export default ProfileUploadFlow;
