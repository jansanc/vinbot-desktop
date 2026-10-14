import { Check, ChevronDown, Globe } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import { LOCALES } from "../i18n/messages";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

/**
 * The interface language, as the web app's LanguageSelect: a globe and the
 * current language's name, the four languages in their own names below.
 * Switching is instant and kept for the next launch (I18nContext).
 */
export default function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label={t("languages.label")}>
          <Globe aria-hidden />
          <span>{t(`languages.${locale}`)}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {LOCALES.map((option) => (
          <DropdownMenuItem
            key={option}
            lang={option}
            onSelect={() => setLocale(option)}
            className="justify-between"
          >
            <span className={option === locale ? "font-medium" : undefined}>{t(`languages.${option}`)}</span>
            {option === locale && <Check className="text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
