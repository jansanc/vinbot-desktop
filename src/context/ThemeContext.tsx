import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // Get saved theme or use system preference during initialization
    const saved = localStorage.getItem("theme") as Theme | null;
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    return saved || (prefersDark ? "dark" : "light");
  });

  useEffect(() => {
    // Apply theme to DOM after mount
    applyTheme(theme);
  }, [theme]);

  // As the web app: html.dark or html.light (input.css keys the palette and
  // the dark: variant off them).
  const applyTheme = (newTheme: Theme) => {
    const html = document.documentElement;
    html.classList.toggle("dark", newTheme === "dark");
    html.classList.toggle("light", newTheme === "light");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", newTheme === "dark" ? "#0f1014" : "#f6f7f9");
    localStorage.setItem("theme", newTheme);
  };

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
