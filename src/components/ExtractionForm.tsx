import React, { useState } from "react";
import "../styles/ExtractionForm.css";

interface ExtractionFormProps {
  onSubmit: (formData: {
    browser: "firefox" | "chrome" | "edge";
    profile?: string;
    vintedEmail: string;
    userEmail: string;
    vintedMemberId: string;
    saveMethod: "file";
    vintedBaseUrl: string;
  }) => Promise<void>;
  firefoxProfiles: string[];
  loadingProfiles: boolean;
}

const ExtractionForm: React.FC<ExtractionFormProps> = ({
  onSubmit,
  firefoxProfiles,
  loadingProfiles,
}) => {
  const [selectedBrowser, setSelectedBrowser] = useState<"firefox" | "chrome" | "edge">("firefox");

  const [formData, setFormData] = useState<{
    browser: "firefox" | "chrome" | "edge";
    profile: string;
    vintedEmail: string;
    userEmail: string;
    vintedMemberId: string;
    saveMethod: "file";
    vintedBaseUrl: string;
  }>({
    browser: "firefox",
    profile: firefoxProfiles[0] || "",
    vintedEmail: "",
    userEmail: "",
    vintedMemberId: "",
    saveMethod: "file",
    vintedBaseUrl: "https://www.vinted.com",
  });

  // Sync profile selection when profiles load
  React.useEffect(() => {
    if (firefoxProfiles.length > 0 && !formData.profile) {
      setFormData(prev => ({
        ...prev,
        profile: firefoxProfiles[0]
      }));
    }
  }, [firefoxProfiles]);

  const handleBrowserChange = (newBrowser: "firefox" | "chrome" | "edge") => {
    setSelectedBrowser(newBrowser);
    setFormData(prev => ({
      ...prev,
      browser: newBrowser,
    }));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.vintedEmail.trim()) {
      errors.vintedEmail = "Vinted email is required";
    } else if (!formData.vintedEmail.includes("@")) {
      errors.vintedEmail = "Invalid email format";
    }

    if (!formData.vintedMemberId.trim()) {
      errors.vintedMemberId = "Vinted member ID is required";
    } else if (!/^\d+$/.test(formData.vintedMemberId)) {
      errors.vintedMemberId = "Member ID should be numeric";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear validation error for this field
    if (validationErrors[name]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  return (
    <div className="form-container">
      <div className="form-card">
        <h2>📋 Extraction Configuration</h2>

        <form onSubmit={handleSubmit} className="extraction-form">
          {/* Browser Selection */}
          <div className="form-group">
            <label>🌐 Select Browser</label>
            <div className="browser-selector">
              {["firefox", "chrome", "edge"].map((browser) => (
                <button
                  key={browser}
                  type="button"
                  className={`browser-btn ${selectedBrowser === browser ? "active" : ""}`}
                  onClick={() => handleBrowserChange(browser as "firefox" | "chrome" | "edge")}
                >
                  {browser === "firefox" && "🦊 Firefox"}
                  {browser === "chrome" && "💠 Chrome"}
                  {browser === "edge" && "🌊 Edge"}
                </button>
              ))}
            </div>
          </div>

          {/* Profile Selection */}
          {firefoxProfiles.length > 0 && (
            <div className="form-group">
              <label htmlFor="profile">
                {selectedBrowser === "firefox" && "🦊 Firefox Profile"}
                {selectedBrowser === "chrome" && "💠 Chrome Profile"}
                {selectedBrowser === "edge" && "🌊 Edge Profile"}
                {loadingProfiles && (
                  <span className="loading-badge">Loading...</span>
                )}
              </label>
              <select
                id="profile"
                name="profile"
                value={formData.profile}
                onChange={handleChange}
                disabled={loadingProfiles || firefoxProfiles.length === 0}
                className="form-control"
              >
                {firefoxProfiles.length === 0 && !loadingProfiles && (
                  <option value="">No profiles found</option>
                )}
                {firefoxProfiles.map((profile) => (
                  <option key={profile} value={profile}>
                    {profile}
                  </option>
                ))}
              </select>
              <small>
                {selectedBrowser === "firefox" && "Select your Firefox profile"}
                {selectedBrowser === "chrome" && "Select your Chrome profile"}
                {selectedBrowser === "edge" && "Select your Edge profile"}
              </small>
            </div>
          )}

          {/* Vinted Base URL */}
          <div className="form-group">
            <label htmlFor="vintedBaseUrl">🌐 Vinted Base URL</label>
            <input
              id="vintedBaseUrl"
              name="vintedBaseUrl"
              type="text"
              value={formData.vintedBaseUrl}
              onChange={handleChange}
              placeholder="https://www.vinted.com"
              className="form-control"
            />
            <small>Default is the global Vinted site</small>
          </div>

          {/* Vinted Email */}
          <div className="form-group">
            <label htmlFor="vintedEmail">
              📧 Vinted Account Email <span className="required">*</span>
            </label>
            <input
              id="vintedEmail"
              name="vintedEmail"
              type="email"
              value={formData.vintedEmail}
              onChange={handleChange}
              placeholder="your-email@vinted.com"
              className={`form-control ${validationErrors.vintedEmail ? "error" : ""}`}
            />
            {validationErrors.vintedEmail && (
              <small className="error-text">
                {validationErrors.vintedEmail}
              </small>
            )}
          </div>

          {/* Vinted Member ID */}
          <div className="form-group">
            <label htmlFor="vintedMemberId">
              👤 Vinted Member ID <span className="required">*</span>
            </label>
            <input
              id="vintedMemberId"
              name="vintedMemberId"
              type="text"
              value={formData.vintedMemberId}
              onChange={handleChange}
              placeholder="e.g., 3160974572"
              className={`form-control ${validationErrors.vintedMemberId ? "error" : ""}`}
            />
            <small>
              Find it in your profile URL: vinted.com/member/
              <strong>YOUR_ID</strong>
            </small>
            {validationErrors.vintedMemberId && (
              <small className="error-text">
                {validationErrors.vintedMemberId}
              </small>
            )}
          </div>


          <button
            type="submit"
            disabled={isSubmitting || loadingProfiles}
            className="btn btn-primary btn-large"
          >
            {isSubmitting ? "⏳ Extracting..." : "🚀 Start Extraction"}
          </button>
        </form>

        <div className="info-box">
          <h3>ℹ️ What will be extracted?</h3>
          <ul>
            <li>
              ✓ Browser fingerprint (userAgent, timezone, locale, screen,
              hardware)
            </li>
            <li>✓ Authentication cookies</li>
            <li>✓ LocalStorage data</li>
            <li>✓ SessionStorage data</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ExtractionForm;
