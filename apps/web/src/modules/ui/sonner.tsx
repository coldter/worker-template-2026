import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

import { useTheme } from "@/context/theme-provider";

export const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  // SAFETY: React's CSSProperties has no index signature for CSS custom properties, so the cast supplies only the `--*` variables Sonner reads at runtime.
  return (
    <Sonner
      className="toaster group [&_div[data-content]]:w-full"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--popover-foreground)",
        } as React.CSSProperties
      }
      theme={theme}
      {...props}
    />
  );
};
