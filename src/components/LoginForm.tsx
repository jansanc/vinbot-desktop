import React, { useState } from "react";
import ThemeToggle from "./ThemeToggle";

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

/** Google's "G" mark, in its brand colours as the guidelines require. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

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

  return (
    <div className="login-container">
      <div style={{ position: "absolute", top: "1.25rem", right: "1.25rem", zIndex: 10 }}>
        <ThemeToggle />
      </div>

      <div className="login-card">
        <div className="login-header">
          <h2>Sign In</h2>
          <p>Log in to your Vinted account</p>
        </div>

        {(error || localError) && (
          <div className="login-error">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error || localError}</span>
          </div>
        )}

        {google && (
          <div className="google-sign-in">
            {google.isWaiting ? (
              <div className="google-waiting" role="status">
                <span className="spinner"></span>
                <span>Continue in your browser to sign in with Google.</span>
                <button type="button" className="google-cancel" onClick={google.onCancel}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-google"
                onClick={google.onSignIn}
                disabled={isLoading}
              >
                <GoogleMark />
                Continue with Google
              </button>
            )}
            <div className="login-divider" role="separator">
              <span>or</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={isLoading}
              className="form-input"
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-input-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={isLoading}
                className="form-input"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
                tabIndex={-1}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary btn-login"
          >
            {isLoading ? (
              <>
                <span className="spinner"></span>
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="login-footer">
          <p className="help-text">
            Don't have an account?{" "}
            <a href="https://www.vinted.com" target="_blank" rel="noopener noreferrer">
              Create one on Vinted
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
