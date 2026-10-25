import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Eye,
  KeyRound,
  List,
  LogIn,
  LogOut,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Unlock,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  UserX,
} from "lucide-react";

import { getEventIconName } from "./event-utils";
import type { KnownEventIconName } from "./event-utils";

const iconMap = {
  Activity,
  Eye,
  KeyRound,
  List,
  LogIn,
  LogOut,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Unlock,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  UserX,
} satisfies Record<KnownEventIconName, LucideIcon>;

interface EventIconProps {
  event: string;
  className?: string;
}

export const EventIcon = ({ event, className }: EventIconProps) => {
  const iconName = getEventIconName(event);
  const Icon = iconMap[iconName];

  return <Icon className={className} />;
};
