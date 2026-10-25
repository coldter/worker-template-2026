import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(MOBILE_QUERY);

  mql.addEventListener("change", onChange);

  return () => mql.removeEventListener("change", onChange);
};

const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT;

const getServerSnapshot = () => false;

export const useIsMobile = () =>
  React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
