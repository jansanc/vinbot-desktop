import React from "react";
import { AlertCircle, CheckCircle, AlertTriangle, Info, X } from "lucide-react";
import { AppError } from "../utils/errorHandler";

interface ErrorToastProps {
  error: AppError;
  onDismiss: () => void;
}

export const ErrorToast: React.FC<ErrorToastProps> = ({ error, onDismiss }) => {
  const getSeverityStyles = () => {
    switch (error.severity) {
      case "critical":
      case "error":
        return {
          bg: "bg-red-50 dark:bg-red-900/20",
          border: "border-red-200 dark:border-red-800",
          text: "text-red-900 dark:text-red-300",
          icon: "text-red-600 dark:text-red-400",
          Icon: AlertCircle,
        };
      case "warning":
        return {
          bg: "bg-yellow-50 dark:bg-yellow-900/20",
          border: "border-yellow-200 dark:border-yellow-800",
          text: "text-yellow-900 dark:text-yellow-300",
          icon: "text-yellow-600 dark:text-yellow-400",
          Icon: AlertTriangle,
        };
      case "info":
        return {
          bg: "bg-blue-50 dark:bg-blue-900/20",
          border: "border-blue-200 dark:border-blue-800",
          text: "text-blue-900 dark:text-blue-300",
          icon: "text-blue-600 dark:text-blue-400",
          Icon: Info,
        };
      default:
        return {
          bg: "bg-gray-50 dark:bg-gray-900/20",
          border: "border-gray-200 dark:border-gray-800",
          text: "text-gray-900 dark:text-gray-300",
          icon: "text-gray-600 dark:text-gray-400",
          Icon: Info,
        };
    }
  };

  const styles = getSeverityStyles();

  return (
    <div
      className={`${styles.bg} ${styles.border} border rounded-lg p-4 flex gap-3 items-start animate-in fade-in slide-in-from-top-2 duration-300`}
    >
      <styles.Icon className={`w-5 h-5 ${styles.icon} shrink-0 mt-0.5`} />
      <div className={`flex-1 ${styles.text}`}>
        <p className="font-medium text-sm">{error.userMessage}</p>
        {error.message !== error.userMessage && (
          <p className="text-xs opacity-75 mt-1">{error.message}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className={`${styles.text} opacity-60 hover:opacity-100 transition-opacity shrink-0`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

interface ErrorToastContainerProps {
  errors: AppError[];
  onDismiss: (timestamp: string) => void;
}

export const ErrorToastContainer: React.FC<ErrorToastContainerProps> = ({ errors, onDismiss }) => {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {errors.map((error) => (
        <ErrorToast
          key={error.timestamp}
          error={error}
          onDismiss={() => onDismiss(error.timestamp)}
        />
      ))}
    </div>
  );
};
