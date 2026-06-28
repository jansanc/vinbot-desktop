import React, { useState, useEffect } from "react";

interface ProgressDisplayProps {
  stage: "extracting" | "saving";
  browser?: "chrome" | "firefox" | "edge";
}

const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ stage, browser = "chrome" }) => {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  const browserLabel = browser === "firefox" ? "Firefox" : browser === "chrome" ? "Chrome" : "Edge";

  const steps =
    stage === "extracting"
      ? [
          { label: `Locating ${browserLabel} profile`, duration: 1000 },
          { label: "Extracting browser fingerprint", duration: 2000 },
          { label: "Extracting cookies", duration: 2000 },
          { label: "Extracting localStorage", duration: 2000 },
          { label: "Extracting sessionStorage", duration: 2000 },
        ]
      : [
          { label: "Saving extraction data", duration: 2000 },
          { label: "Processing authentication data", duration: 2000 },
          { label: "Finalizing...", duration: 1000 },
        ];

  useEffect(() => {
    let timer: NodeJS.Timeout;
    let currentIndex = 0;

    const runSteps = () => {
      if (currentIndex < steps.length) {
        setCurrentStep(currentIndex);
        setProgress((currentIndex / steps.length) * 100);

        timer = setTimeout(() => {
          currentIndex++;
          runSteps();
        }, steps[currentIndex].duration);
      } else {
        setProgress(95); // Stay at 95% until completion signal
      }
    };

    runSteps();

    return () => clearTimeout(timer);
  }, [stage, steps]);

  return (
    <div className="progress-container">
      <div className="progress-card">
        <div className="spinner"></div>

        <h2>
          {stage === "extracting"
            ? "🔄 Extracting Session Data..."
            : "💾 Saving Data..."}
        </h2>

        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
        </div>

        <p className="progress-percentage">{Math.round(progress)}%</p>

        <div className="steps-list">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`step-item ${
                index < currentStep
                  ? "completed"
                  : index === currentStep
                    ? "active"
                    : ""
              }`}
            >
              <span className="step-icon">
                {index < currentStep ? "✓" : index === currentStep ? "⏳" : "○"}
              </span>
              <span className="step-label">{step.label}</span>
            </div>
          ))}
        </div>

        <p className="progress-note">
          Please don't close the application while extraction is in progress...
        </p>
      </div>
    </div>
  );
};

export default ProgressDisplay;
