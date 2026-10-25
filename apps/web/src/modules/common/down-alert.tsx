import { onlineManager } from "@tanstack/react-query";
import {
  CloudOff,
  Construction,
  KeyRound,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useOnlineManager } from "@/hooks/use-online-manager";
import { Alert, AlertDescription } from "@/modules/ui/alert";
import { Button } from "@/modules/ui/button";
import { useAlertStore } from "@/store/alert";

const downAlertConfig = {
  auth_expired: {
    content: "Your login has expired. Please sign in again.",
    icon: KeyRound,
    title: "Session Expired",
    variant: "destructive",
  },
  auth_unavailable: {
    content: "We are having trouble connecting to the authentication server.",
    icon: TriangleAlert,
    title: "Authentication Unavailable",
    variant: "destructive",
  },
  forbidden: {
    content: "You do not have permission to access this resource.",
    icon: ShieldAlert,
    title: "Access Denied",
    variant: "destructive",
  },
  maintenance: {
    content: "We are currently performing scheduled maintenance.",
    icon: Construction,
    title: "Under Maintenance",
    variant: "destructive",
  },
  offline: {
    content: "Check your internet connection.",
    icon: CloudOff,
    title: "You are offline",
    variant: "destructive",
  },
  session_invalidated: {
    content: "Session expired or active elsewhere. Please sign in.",
    icon: KeyRound,
    title: "Logged Out",
    variant: "destructive",
  },
} as const;

export type AlertKeys = keyof typeof downAlertConfig;

export const DownAlert = () => {
  const { isOnline } = useOnlineManager();
  const { downAlert, setDownAlert } = useAlertStore();

  const [dismissedAlerts, setDismissedAlerts] = useState<
    Record<string, boolean>
  >({});

  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (!online) {
          return;
        }

        const { downAlert: storedAlert, setDownAlert: setStoredAlert } =
          useAlertStore.getState();

        if (storedAlert === "offline") {
          setStoredAlert(null);
        }

        setDismissedAlerts((prev) =>
          prev.offline ? { ...prev, offline: false } : prev
        );
      }),
    []
  );

  const onlineAlert = downAlert === "offline" ? null : downAlert;
  const activeAlert = isOnline ? onlineAlert : "offline";

  const dismissAlert = useCallback(() => {
    if (!activeAlert) {
      return;
    }

    setDismissedAlerts((prev) => ({ ...prev, [activeAlert]: true }));
    setDownAlert(null);
  }, [activeAlert, setDownAlert]);

  if (!activeAlert || dismissedAlerts[activeAlert]) {
    return null;
  }

  const config = downAlertConfig[activeAlert];

  const { title, content, icon: Icon, variant } = config;

  return (
    <div className="pointer-events-auto fixed top-4 right-4 left-4 z-50 flex justify-center">
      <Alert
        className="bg-background/95 supports-backdrop-filter:bg-background/60 w-auto shadow-lg backdrop-blur"
        variant={variant}
      >
        <Button
          className="absolute top-1 right-1 h-6 w-6 p-0 hover:bg-transparent"
          onClick={dismissAlert}
          size="sm"
          variant="ghost"
        >
          <X size={16} />
          <span className="sr-only">Dismiss</span>
        </Button>

        <Icon size={16} />
        <AlertDescription className="flex items-center gap-2 pr-6 font-light">
          <span className="font-semibold">{title}</span>
          <span className="mx-1 opacity-50">&#183;</span>
          <span>{content}</span>
        </AlertDescription>
      </Alert>
    </div>
  );
};
