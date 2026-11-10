import { Check } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import { cn } from "@/lib/utils";

/**
 * The two accounts the app asks for, in order: Vinbot first, then Vinted.
 * Shown above both screens so it is always clear which account's details a
 * field wants, and that the Vinted login is a separate, later step.
 */
export default function SetupSteps({ current }: { current: 1 | 2 }) {
  const { t } = useI18n();
  const steps = [t("flow.vinbot"), t("flow.vinted")];

  return (
    <ol aria-label={t("flow.label")} className="flex items-center gap-2 text-[13px]">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-border" />}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                active && "bg-primary text-primary-foreground",
                done && "bg-success/15 text-success",
                !active && !done && "border border-border text-muted-foreground"
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : n}
            </span>
            <span className={cn(active ? "font-medium text-foreground" : "text-muted-foreground")}>
              <span className="sr-only">{t("flow.step", { n })} </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
