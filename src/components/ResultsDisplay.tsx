import React, { useState } from "react";
import { ExtractionData } from "../types";
import "../styles/ResultsDisplay.css";

interface ResultsDisplayProps {
  data: ExtractionData;
  onReset: () => void;
}

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ data, onReset }) => {
  const [expandedSection, setExpandedSection] = useState<string | null>(
    "fingerprint",
  );

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("Copied!");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      setCopyFeedback("Copy failed");
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  const downloadJSON = (filename: string, data: any) => {
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(data, null, 2)),
    );
    element.setAttribute("download", filename);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="results-container">
      <div className="results-card">
        <div className="results-header">
          <h2>✅ Extraction Complete!</h2>
          <p>Your Vinted session data has been successfully extracted</p>
        </div>

        <div className="results-summary">
          <div className="summary-item">
            <span className="summary-icon">📊</span>
            <div className="summary-content">
              <h4>Browser Fingerprint</h4>
              <p>{Object.keys(data.fingerprint).length} properties captured</p>
            </div>
          </div>

          <div className="summary-item">
            <span className="summary-icon">🍪</span>
            <div className="summary-content">
              <h4>Cookies</h4>
              <p>{data.authentication.cookies.length} cookies extracted</p>
            </div>
          </div>

          <div className="summary-item">
            <span className="summary-icon">💾</span>
            <div className="summary-content">
              <h4>Storage Items</h4>
              <p>
                {data.authentication.origins.reduce(
                  (sum, o) =>
                    sum +
                    (o.localStorage?.length || 0) +
                    (o.sessionStorage?.length || 0),
                  0,
                )}{" "}
                items stored
              </p>
            </div>
          </div>

          <div className="summary-item">
            <span className="summary-icon">🌐</span>
            <div className="summary-content">
              <h4>Origins</h4>
              <p>{data.authentication.origins.length} storage origins</p>
            </div>
          </div>
        </div>

        <div className="results-details">
          {/* Fingerprint Section */}
          <div className="detail-section">
            <div
              className="section-header"
              onClick={() => toggleSection("fingerprint")}
            >
              <span className="section-title">📊 Browser Fingerprint</span>
              <span className="toggle-icon">
                {expandedSection === "fingerprint" ? "▼" : "▶"}
              </span>
            </div>
            {expandedSection === "fingerprint" && (
              <div className="section-content">
                <div className="fingerprint-grid">
                  <div className="fingerprint-item">
                    <label>Browser</label>
                    <span>{data.fingerprint.browser}</span>
                  </div>
                  <div className="fingerprint-item">
                    <label>Platform</label>
                    <span>{data.fingerprint.platform}</span>
                  </div>
                  <div className="fingerprint-item">
                    <label>Timezone</label>
                    <span>{data.fingerprint.timezone}</span>
                  </div>
                  <div className="fingerprint-item">
                    <label>Locale</label>
                    <span>{data.fingerprint.locale}</span>
                  </div>
                  <div className="fingerprint-item">
                    <label>Screen Resolution</label>
                    <span>
                      {data.fingerprint.screen.width}x
                      {data.fingerprint.screen.height}
                    </span>
                  </div>
                  <div className="fingerprint-item">
                    <label>Hardware Cores</label>
                    <span>{data.fingerprint.hardwareConcurrency}</span>
                  </div>
                  <div className="fingerprint-item">
                    <label>Device Memory</label>
                    <span>{data.fingerprint.deviceMemory} GB</span>
                  </div>
                  <div className="fingerprint-item">
                    <label>Firefox Version</label>
                    <span>{data.fingerprint.systemInfo.firefoxVersion}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cookies Section */}
          <div className="detail-section">
            <div
              className="section-header"
              onClick={() => toggleSection("cookies")}
            >
              <span className="section-title">
                🍪 Cookies ({data.authentication.cookies.length})
              </span>
              <span className="toggle-icon">
                {expandedSection === "cookies" ? "▼" : "▶"}
              </span>
            </div>
            {expandedSection === "cookies" && (
              <div className="section-content">
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Domain</th>
                        <th>Secure</th>
                        <th>HttpOnly</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.authentication.cookies.map((cookie, idx) => (
                        <tr key={idx}>
                          <td className="mono">{cookie.name}</td>
                          <td>{cookie.domain}</td>
                          <td>{cookie.secure ? "✓" : "✗"}</td>
                          <td>{cookie.httpOnly ? "✓" : "✗"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Storage Origins Section */}
          <div className="detail-section">
            <div
              className="section-header"
              onClick={() => toggleSection("storage")}
            >
              <span className="section-title">
                💾 Storage Origins ({data.authentication.origins.length})
              </span>
              <span className="toggle-icon">
                {expandedSection === "storage" ? "▼" : "▶"}
              </span>
            </div>
            {expandedSection === "storage" && (
              <div className="section-content">
                {data.authentication.origins.map((origin, idx) => (
                  <div key={idx} className="origin-block">
                    <h4>🌐 {origin.origin}</h4>
                    {origin.localStorage && origin.localStorage.length > 0 && (
                      <div className="storage-subsection">
                        <h5>LocalStorage ({origin.localStorage.length})</h5>
                        <ul className="storage-list">
                          {origin.localStorage.map((item, itemIdx) => (
                            <li key={itemIdx}>
                              <span className="storage-key">{item.name}</span>
                              <button
                                className="copy-btn"
                                onClick={() => copyToClipboard(item.value)}
                                title="Copy value"
                              >
                                📋
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {origin.sessionStorage &&
                      origin.sessionStorage.length > 0 && (
                        <div className="storage-subsection">
                          <h5>
                            SessionStorage ({origin.sessionStorage.length})
                          </h5>
                          <ul className="storage-list">
                            {origin.sessionStorage.map((item, itemIdx) => (
                              <li key={itemIdx}>
                                <span className="storage-key">{item.name}</span>
                                <button
                                  className="copy-btn"
                                  onClick={() => copyToClipboard(item.value)}
                                  title="Copy value"
                                >
                                  📋
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="results-actions">
          <button
            className="btn btn-secondary"
            onClick={() =>
              downloadJSON("vinted-fingerprint.json", data.fingerprint)
            }
          >
            💾 Download Fingerprint
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              downloadJSON("vinted-auth-session.json", data.authentication)
            }
          >
            💾 Download Auth Data
          </button>
          <button className="btn btn-primary" onClick={onReset}>
            🔄 New Extraction
          </button>
        </div>

        <div className="security-note">
          <p>
            ⚠️ <strong>Security Notice:</strong> Keep this data secure. Do not
            share your session cookies or authentication tokens with anyone.
            Your data has been saved locally.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResultsDisplay;
