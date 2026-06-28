import { LogOut, User, Zap, Moon, Sun } from "lucide-react";
import { AuthUser } from "../services/auth.service";
import { useTheme } from "../context/ThemeContext";

interface UserHeaderProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
}

const getTierColor = (tier: string | null): string => {
  if (!tier) return "bg-secondary/40 text-muted-foreground";

  const tierLower = tier.toLowerCase();

  if (tierLower === "enterprise")
    return "bg-purple-500/20 text-purple-700 dark:text-purple-300";
  if (tierLower === "pro")
    return "bg-amber-500/20 text-amber-700 dark:text-amber-300";
  if (tierLower === "basic")
    return "bg-blue-500/20 text-blue-700 dark:text-blue-300";

  return "bg-gray-500/20 text-gray-700 dark:text-gray-300";
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
    <header className="border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="flex items-center justify-between px-6 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
            {user.firstName.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <User size={14} className="text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {user.firstName} {user.lastName}
              </span>
              <span
                className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${getTierColor(
                  user.subscriptionTier
                )}`}
              >
                <Zap size={12} />
                {getTierLabel(user.subscriptionTier)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="group relative flex items-center justify-center rounded-lg border border-border bg-secondary/40 p-2 transition-all duration-200 hover:bg-secondary/60 hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? (
              <Moon size={16} className="text-muted-foreground group-hover:text-foreground" />
            ) : (
              <Sun size={16} className="text-muted-foreground group-hover:text-foreground" />
            )}
          </button>

          <button
            onClick={onLogout}
            disabled={isLoggingOut}
            className="group relative flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-4 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:bg-secondary/60 hover:border-border/80 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LogOut size={14} className="text-muted-foreground group-hover:text-foreground" />
            {isLoggingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      </div>
    </header>
  );
}
