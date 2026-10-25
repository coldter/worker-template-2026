import type { UserStatus } from "./types";

interface UserSummaryRecord {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  status: UserStatus;
  roleSlugs: string[];
  createdAt: Date;
  updatedAt: Date;
}

type UserDetailRecord = UserSummaryRecord & {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  deactivatedReason: string | null;
};

interface MyAccountRecord {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toUserSummaryResponse = (user: UserSummaryRecord) => ({
  createdAt: user.createdAt.toISOString(),
  email: user.email,
  emailVerified: user.emailVerified,
  id: user.id,
  image: user.image,
  name: user.name,
  roleSlugs: user.roleSlugs,
  status: user.status,
  updatedAt: user.updatedAt.toISOString(),
});

export const toUserDetailResponse = (user: UserDetailRecord) => ({
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
});

export const toMyAccountResponse = (user: MyAccountRecord) => ({
  createdAt: user.createdAt.toISOString(),
  email: user.email,
  emailVerified: user.emailVerified,
  id: user.id,
  image: user.image,
  name: user.name,
  onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
  updatedAt: user.updatedAt.toISOString(),
});
