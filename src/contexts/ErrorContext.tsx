import React, { createContext, useContext, useState, useCallback } from "react";
import { AppError, ErrorHandler } from "../utils/errorHandler";

interface ErrorContextType {
  errors: AppError[];
  addError: (error: unknown, context?: string) => void;
  removeError: (timestamp: string) => void;
  clearErrors: () => void;
  getLastError: () => AppError | null;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const ErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [errors, setErrors] = useState<AppError[]>([]);

  const addError = useCallback((error: unknown, context?: string) => {
    const appError = ErrorHandler.handle(error);
    ErrorHandler.log(appError, context);
    setErrors((prev) => [...prev, appError]);

    // Auto-remove non-critical errors after 8 seconds
    if (appError.severity !== "critical" && appError.severity !== "error") {
      const timer = setTimeout(() => {
        removeError(appError.timestamp);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, []);

  const removeError = useCallback((timestamp: string) => {
    setErrors((prev) => prev.filter((err) => err.timestamp !== timestamp));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  const getLastError = useCallback(() => {
    return errors.length > 0 ? errors[errors.length - 1] : null;
  }, [errors]);

  return (
    <ErrorContext.Provider value={{ errors, addError, removeError, clearErrors, getLastError }}>
      {children}
    </ErrorContext.Provider>
  );
};

export const useError = (): ErrorContextType => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error("useError must be used within ErrorProvider");
  }
  return context;
};
