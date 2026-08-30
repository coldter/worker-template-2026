import type { UserStatus } from "./types";

type UserSummaryRecord = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  status: UserStatus;
  roleSlugs: string[];
  createdAt: Date;
  updatedAt: Date;
};

type UserDetailRecord = UserSummaryRecord & {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  deactivatedReason: string | null;
};

type MyAccountRecord = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toUserSummaryResponse(user: UserSummaryRecord) {
  return {
    createdAt: user.createdAt.toISOString(),
    email: user.email,
    emailVerified: user.emailVerified,
    id: user.id,
    image: user.image,
    name: user.name,
    roleSlugs: user.roleSlugs,
    status: user.status,
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toUserDetailResponse(user: UserDetailRecord) {
  return {
    createdAt: user.createdAt.toISOString(),
    deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
    deactivatedBy: user.deactivatedBy,
    deactivatedReason: user.deactivatedReason,
    email: user.email,
    emailVerified: user.emailVerified,
    failedLoginAttempts: user.failedLoginAttempts,
    id: user.id,
    image: user.image,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    name: user.name,
    roleSlugs: user.roleSlugs,
    status: user.status,
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toMyAccountResponse(user: MyAccountRecord) {
  return {
    createdAt: user.createdAt.toISOString(),
    email: user.email,
    emailVerified: user.emailVerified,
    id: user.id,
    image: user.image,
    name: user.name,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    updatedAt: user.updatedAt.toISOString(),
  };
}
