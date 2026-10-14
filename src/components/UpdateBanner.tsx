import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import { Button } from "./ui/button";

/**
 * "Version x is ready": shown once main has downloaded an update
 * (src/main/updater.ts). Restart installs it now; Later hides the card, and
 * the update installs the next time the app quits anyway. Downloading itself
 * is silent.
 */
export default function UpdateBanner() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const updater = window.electronAPI?.updater;
    if (!updater) return;
    // An update may have finished downloading before this mounted
    updater.getStatus().then(setStatus).catch(() => {});
    return updater.onStatus(setStatus);
  }, []);

  if (status.state !== "ready" || dismissedVersion === status.version) return null;

  const restart = async () => {
    setBusy(false);
    setRestarting(true);
    const result = await window.electronAPI.updater!.install().catch(() => ({ ok: false as const, reason: "not-ready" as const }));
    if (!result.ok) {
      setRestarting(false);
      setBusy(result.reason === "busy");
    }
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-40 w-full max-w-sm animate-toast-in rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-[var(--highlight),var(--shadow-lg)]"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
          <Download className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{t("update.title", { version: status.version })}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {busy ? t("update.busy") : t("update.body")}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={restart} disabled={restarting}>
              {t("update.restart")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissedVersion(status.version)}>
              {t("update.later")}
            </Button>
          </div>
        </div>
        <button
          onClick={() => setDismissedVersion(status.version)}
          aria-label={t("errors.dismiss")}
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
