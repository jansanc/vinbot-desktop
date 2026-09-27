import { LogOut, Zap, Moon, Sun } from "lucide-react";
import { AuthUser } from "../services/auth.service";
import { useTheme } from "../context/ThemeContext";

interface UserHeaderProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
}

const getTierGradient = (tier: string | null): string => {
  const tierLower = tier?.toLowerCase();

  if (tierLower === "enterprise")
    return "from-purple-500 to-purple-600";
  if (tierLower === "pro")
    return "from-amber-500 to-amber-600";
  if (tierLower === "basic")
    return "from-blue-500 to-blue-600";

  return "from-gray-400 to-gray-500";
};

const getTierColor = (tier: string | null): string => {
  const tierLower = tier?.toLowerCase();

  if (tierLower === "enterprise")
    return "bg-purple-50 border border-purple-200 text-purple-900 dark:bg-purple-500/20 dark:border-purple-400/30 dark:text-purple-300";
  if (tierLower === "pro")
    return "bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-500/20 dark:border-amber-400/30 dark:text-amber-300";
  if (tierLower === "basic")
    return "bg-blue-50 border border-blue-200 text-blue-900 dark:bg-blue-500/20 dark:border-blue-400/30 dark:text-blue-300";

  return "bg-gray-50 border border-gray-200 text-gray-700 dark:bg-gray-500/20 dark:border-gray-400/30 dark:text-gray-300";
};

const getTierLabel = (tier: string | null): string => {
  return tier ? tier.toUpperCase() : "FREE";
};

export default function UserHeader({
  user,
  onLogout,
  isLoggingOut,
}: UserHeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="border-b border-border/50 bg-card/40 backdrop-blur-md">
      <div className="flex items-center justify-between px-6 py-5 sm:px-8">
        <div className="flex items-center gap-4">
          <div className={`relative flex size-10 items-center justify-center rounded-xl bg-linear-to-br ${getTierGradient(user.subscriptionTier)} text-sm font-bold text-white shadow-sm ring-2 ring-white/10`}>
            {user.firstName.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {user.firstName} {user.lastName}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${getTierColor(
                  user.subscriptionTier
                )}`}
              >
                <Zap size={11} className="fill-current" />
                {getTierLabel(user.subscriptionTier)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleTheme}
            className="relative inline-flex items-center justify-center rounded-lg border border-border/50 bg-secondary/50 p-2 text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? (
              <Moon size={16} className="transition-transform duration-200" />
            ) : (
              <Sun size={16} className="transition-transform duration-200" />
            )}
          </button>

          <button
            onClick={onLogout}
            disabled={isLoggingOut}
            className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/50 px-3.5 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:bg-secondary hover:border-border disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">{isLoggingOut ? "Logging out..." : "Log out"}</span>
            <span className="sm:hidden">{isLoggingOut ? "..." : ""}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
