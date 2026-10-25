import type { USER_STATUS_CONFIG as SHARED_USER_STATUS_CONFIG } from "@repo/shared/users";

import type { GetUserResponse, ListUsersResponse } from "@/api.gen/types.gen";

export { USER_STATUS_CONFIG } from "@repo/shared/users";

export type User = ListUsersResponse["data"][number];

export type UserDetail = GetUserResponse["user"];

export type UserStatus = keyof typeof SHARED_USER_STATUS_CONFIG;
