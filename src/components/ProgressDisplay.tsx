import React from "react";

interface ProgressDisplayProps {
  stage: "extracting" | "saving";
  browser?: "chrome" | "firefox" | "edge";
  isComplete?: boolean;
}

const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ isComplete = false }) => {
  if (isComplete) {
    return (
      <div className="progress-container">
        <div className="success-message">
          <div className="success-icon">✓</div>
          <h2>Success!</h2>
          <p>Your data has been extracted and saved.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="progress-container">
      <div className="animated-loader">
        <div className="loader-shape"></div>
        <div className="loader-ring"></div>
      </div>
    </div>
  );
};

export default ProgressDisplay;
