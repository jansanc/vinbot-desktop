import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useI18n } from "../i18n/I18nContext";
import { Button } from "./ui/button";

// As the web app's: a ghost icon button showing the theme it switches to.
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const label = t(theme === "dark" ? "theme.toLight" : "theme.toDark");

  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
