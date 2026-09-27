import React from "react";
import { CheckCircle2, Cookie, Shield } from "lucide-react";
import { ExtractionData } from "../types";

interface ResultsDisplayProps {
  onReset: () => void;
  extractionData?: ExtractionData;
}

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ onReset, extractionData }) => {
  const cookieCount = extractionData?.authentication?.cookies?.length || 0;

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-green-300 bg-green-50/40 dark:border-green-400/20 dark:bg-green-950/20 p-8 shadow-md">
        <div className="absolute inset-0 bg-linear-to-br from-green-100/40 to-transparent dark:from-green-500/5 dark:to-green-500/5" />
        <div className="relative space-y-6">
          <div className="flex items-center justify-center">
            <div className="rounded-full bg-linear-to-br from-green-100 to-green-50 dark:bg-green-500/20 p-3">
              <CheckCircle2 size={32} className="text-green-600 dark:text-green-400" />
            </div>
          </div>

          <div className="space-y-2 text-center">
            <h3 className="text-xl font-bold text-green-700 dark:text-foreground">You're all set!</h3>
            <p className="text-sm text-gray-600 dark:text-muted-foreground leading-relaxed">
              Your authentication has been verified and your account is now active on Vinbot.
            </p>
          </div>

          {cookieCount > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-green-400/60 bg-linear-to-r from-green-100/60 to-green-50/40 dark:border-green-400/20 dark:bg-green-500/10 px-4 py-3 shadow-xs">
              <div className="rounded-lg bg-green-300/50 dark:bg-green-400/20 p-2">
                <Cookie size={16} className="text-green-700 dark:text-green-400 shrink-0" />
              </div>
              <div className="text-sm">
                <span className="font-bold text-green-900 dark:text-green-300">{cookieCount}</span>
                <span className="text-green-700 dark:text-green-400/70"> {cookieCount === 1 ? 'cookie' : 'cookies'} retrieved</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onReset}
        className="w-full rounded-lg border border-green-400 bg-green-100/70 px-4 py-2.5 text-sm font-semibold text-green-800 transition-all duration-200 hover:bg-green-200/60 hover:border-green-500 dark:border-green-400/30 dark:bg-green-500/15 dark:text-green-300 dark:hover:bg-green-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Link Another Account
      </button>

      <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/50 dark:border-amber-400/20 dark:bg-amber-950/20 px-4 py-3 shadow-xs">
        <div className="rounded-lg bg-amber-200/60 dark:bg-amber-400/20 p-2 mt-0.5 shrink-0">
          <Shield size={16} className="text-amber-700 dark:text-amber-400" />
        </div>
        <div className="text-xs leading-relaxed text-amber-900 dark:text-amber-300">
          <strong>Security Notice:</strong> Keep your login credentials secure. Do not share your session data with anyone.
        </div>
      </div>
    </div>
  );
};

export default ResultsDisplay;
