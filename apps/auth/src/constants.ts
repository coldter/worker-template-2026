export const LOCKOUT_CONFIG = {
  maxFailedAttempts: 3,
  lockoutDurationMinutes: 15,
} as const;

/**
 * Per-IP cap combined with the per-account lockout above: keep max strictly
 * greater than LOCKOUT_CONFIG.maxFailedAttempts so the lockout fires before
 * a 429 on a single mistyped password, while still throttling credential
 * stuffing that rotates emails behind one IP.
 */
export const RATE_LIMIT_CONFIG = {
  signIn: {
    window: 60,
    max: 10,
  },
  global: {
    window: 60,
    max: 1000,
  },
} as const;

export function calculateLockoutExpiry(): Date {
  return new Date(
    Date.now() + LOCKOUT_CONFIG.lockoutDurationMinutes * 60 * 1000
  );
}

export function isLockoutExpired(lockedUntil: Date | null): boolean {
  if (!lockedUntil) {
    return true;
  }
  return lockedUntil <= new Date();
}

export const TWO_FACTOR_CONFIG = {
  otpLength: 6,
  emailOtpExpiresIn: 300,
  twoFactorOtpPeriodMinutes: 3,
} as const;
