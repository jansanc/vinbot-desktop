import en from "./en";
import es from "./es";
import ca from "./ca";
import fr from "./fr";

/**
 * The app's languages, the same four as the web app. Plain data and functions
 * only, so both processes use it: the renderer through I18nContext, main for
 * what it shows itself (the page the browser lands on after Google sign-in).
 */

/** Order of the language picker, as on the web. */
export const LOCALES = ["es", "ca", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** English's shape with every value a string: a language missing a key, or
 *  adding one, fails to compile. */
type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };
export type Messages = Strings<typeof en>;

/** "login.signIn" and the like: every leaf of the messages. */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

export type MessageVars = Record<string, string | number>;

const MESSAGES: Record<Locale, Messages> = { en, es, ca, fr };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first supported language in a preference list ("ca-ES", "es", ...), as
 * the web app reads Accept-Language, so a first launch on a Spanish system is
 * not in English.
 */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lang = tag.split("-")[0].toLowerCase();
    if (isLocale(lang)) return lang;
  }
  return DEFAULT_LOCALE;
}

/** The text for a key in a language, {name} placeholders filled in. Falls back
 *  to English, then to the key itself. */
export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const lookup = (messages: Messages) =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
  const found = lookup(MESSAGES[locale]) ?? lookup(MESSAGES[DEFAULT_LOCALE]);
  const text = typeof found === "string" ? found : key;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text;
}
