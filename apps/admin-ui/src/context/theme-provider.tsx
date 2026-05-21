import { createContext, type ReactNode, useContext, useEffect } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: "light" });

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

// Light-only by design: the operator console intentionally ships without a
// theme switcher to keep the surface area minimal.
export function ThemeProvider({
  children,
  defaultTheme = "light",
}: ThemeProviderProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(defaultTheme);
  }, [defaultTheme]);

  return (
    <ThemeContext value={{ theme: defaultTheme }}>{children}</ThemeContext>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
