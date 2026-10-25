import type * as React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { CommandMenu } from "@/modules/common/command-menu";

interface SearchContextType {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const SearchContext = createContext<SearchContextType | null>(null);

interface SearchProviderProps {
  children: React.ReactNode;
}

export const SearchProvider = ({ children }: SearchProviderProps) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);

    return () => document.removeEventListener("keydown", down);
  }, []);

  const value = useMemo(() => ({ open, setOpen }), [open]);

  return (
    <SearchContext value={value}>
      {children}
      <CommandMenu onOpenChange={setOpen} open={open} />
    </SearchContext>
  );
};

export const useSearchBar = () => {
  const searchContext = useContext(SearchContext);

  if (!searchContext) {
    throw new Error("useSearchBar has to be used within SearchProvider");
  }

  return searchContext;
};
