import { LogOut } from "lucide-react";
import { AuthUser } from "../services/auth.service";
import ThemeToggle from "./ThemeToggle";
import LanguageSelect from "./LanguageSelect";
import { useI18n } from "../i18n/I18nContext";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface UserHeaderProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
}

/**
 * The plan as the web app shows it: a tinted badge, indigo for a paid plan
 * (badge "default"), neutral otherwise.
 */
function PlanBadge({ tier }: { tier: string | null }) {
  const { t } = useI18n();
  const paid = !!tier && ["basic", "pro", "enterprise"].includes(tier.toLowerCase());
  const label = tier ? tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase() : t("header.planFree");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-4",
        paid ? "border-primary/25 bg-primary/12 text-primary" : "border-border bg-secondary text-secondary-foreground"
      )}
    >
      {label}
    </span>
  );
}

/** The signed-in top bar, as the web app's: wordmark left, account right. */
export default function UserHeader({
  user,
  onLogout,
  isLoggingOut,
}: UserHeaderProps) {
  const { t } = useI18n();
  const initial = (user.firstName || user.email || "?").charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/85 px-5 backdrop-blur-md">
      <span className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
        <img src="brand/vinbot-mark-32.png" alt="" width={24} height={24} className="h-6 w-6" />
        Vinbot
        <span className="font-normal text-muted-foreground">{t("header.authenticator")}</span>
      </span>

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
          >
            {initial}
          </span>
          <div className="hidden min-w-0 leading-tight sm:block">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium">
                {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}
              </span>
              <PlanBadge tier={user.subscriptionTier} />
            </div>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <span className="h-5 w-px bg-border" aria-hidden="true" />

        <LanguageSelect />
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={onLogout} disabled={isLoggingOut}>
          <LogOut aria-hidden />
          {isLoggingOut ? t("header.loggingOut") : t("header.logout")}
        </Button>
      </div>
    </header>
  );
}
