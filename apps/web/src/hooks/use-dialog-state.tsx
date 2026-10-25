import { useState } from "react";

export default function useDialogState<T extends string | boolean>(
  initialState: T | null = null
) {
  const [open, setOpen] = useState<T | null>(initialState);

  const updateOpen = (str: T | null) =>
    setOpen((prev) => (prev === str ? null : str));

  return [open, updateOpen] as const;
}
