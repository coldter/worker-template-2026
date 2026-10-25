import type { LinkProps } from "@tanstack/react-router";

import type { Capability } from "@/hooks/use-authorization";

export interface User {
  name: string;
  email: string;
  avatar: string;
}

export interface BaseNavItem {
  title: string;
  badge?: string;
  icon?: React.ElementType;
  permission?: Capability | null;
}

export type NavLink = BaseNavItem & {
  url: LinkProps["to"] | (string & NonNullable<unknown>);
  items?: never;
};

export type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & {
    url: LinkProps["to"] | (string & NonNullable<unknown>);
  })[];
  url?: never;
};

export type NavItem = NavCollapsible | NavLink;

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface SidebarData {
  user: User;
  navGroups: NavGroup[];
}
