import type * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useUIStore } from "@/store";
import type { Theme } from "@/store";

type ResolvedTheme = Exclude<Theme, "system">;

const DEFAULT_THEME = "light";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
}

interface ThemeProviderState {
  defaultTheme: Theme;
  resolvedTheme: ResolvedTheme;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resetTheme: () => void;
}

const initialState: ThemeProviderState = {
  defaultTheme: DEFAULT_THEME,
  resetTheme: () => null,
  resolvedTheme: "light",
  setTheme: () => null,
  theme: DEFAULT_THEME,
};

const ThemeContext = createContext<ThemeProviderState>(initialState);

export const ThemeProvider = ({
  children,
  defaultTheme = DEFAULT_THEME,
  ...props
}: ThemeProviderProps) => {
  const theme = useUIStore((state) => state.theme);
  const setThemeStore = useUIStore((state) => state.setTheme);

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      setThemeStore(nextTheme);
    },
    [setThemeStore]
  );

  const resetTheme = useCallback(() => {
    setThemeStore(DEFAULT_THEME);
  }, [setThemeStore]);

  const contextValue = useMemo(
    () => ({
      defaultTheme,
      resetTheme,
      resolvedTheme,
      setTheme,
      theme,
    }),
    [defaultTheme, resetTheme, resolvedTheme, setTheme, theme]
  );

  return (
    <ThemeContext value={contextValue} {...props}>
      {children}
    </ThemeContext>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
