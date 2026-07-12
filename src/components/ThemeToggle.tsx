import React from "react";
import { useTheme } from "../context/ThemeContext";

const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`theme-toggle ${className}`}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <div className="theme-toggle-icons">
        <span className="sun-icon">☀️</span>
        <span className="moon-icon">🌙</span>
      </div>
      <div className={`theme-toggle-slider ${theme}`} />
    </button>
  );
};

export default ThemeToggle;
