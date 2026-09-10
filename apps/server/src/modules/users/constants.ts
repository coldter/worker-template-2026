import { USER_STATUS as SHARED_USER_STATUS } from "@repo/shared/users";

export const USER_STATUS = SHARED_USER_STATUS;

export const USER_STATUS_VALUES = Object.values(USER_STATUS);

export const USERS_SORT_COLUMNS = {
  createdAt: "createdAt",
  email: "email",
  name: "name",
  status: "status",
  updatedAt: "updatedAt",
} as const;

export const USERS_SORT_COLUMN_VALUES = Object.values(USERS_SORT_COLUMNS);
