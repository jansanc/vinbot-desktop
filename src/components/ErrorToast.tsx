import React from "react";
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { AppError } from "../utils/errorHandler";
import { cn } from "@/lib/utils";

interface ErrorToastProps {
  error: AppError;
  onDismiss: () => void;
}

// The web app's notices: a raised surface with the state's colour on the icon
// and a hairline edge, the text in the foreground colour.
const SEVERITY = {
  error: { Icon: AlertCircle, tone: "text-destructive", edge: "border-destructive/30" },
  warning: { Icon: AlertTriangle, tone: "text-warning", edge: "border-warning/30" },
  info: { Icon: Info, tone: "text-primary", edge: "border-border" },
} as const;

export const ErrorToast: React.FC<ErrorToastProps> = ({ error, onDismiss }) => {
  const { Icon, tone, edge } =
    error.severity === "critical" || error.severity === "error"
      ? SEVERITY.error
      : error.severity === "warning"
        ? SEVERITY.warning
        : SEVERITY.info;

  return (
    <div
      role="alert"
      className={cn(
        "flex animate-toast-in items-start gap-3 rounded-xl border bg-popover p-3.5 text-popover-foreground shadow-[var(--highlight),var(--shadow-lg)]",
        edge
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{error.userMessage}</p>
        {error.message !== error.userMessage && (
          <p className="mt-1 wrap-break-word text-xs text-muted-foreground">{error.message}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
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
    <div className="fixed right-4 top-16 z-50 w-full max-w-sm space-y-2">
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
