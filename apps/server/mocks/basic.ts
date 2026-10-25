import { faker } from "@faker-js/faker";

import { nanoid } from "./utils";

export const mockUser = (
  overrides: Partial<{
    id: string;
    email: string;
    name: string;
  }> = {}
) => ({
  createdAt: new Date(),
  email: overrides.email ?? faker.internet.email().toLowerCase(),
  emailVerified: true,
  id: overrides.id ?? nanoid(),
  name: overrides.name ?? faker.person.fullName(),
  updatedAt: new Date(),
});

export const mockSession = (
  userId: string,
  overrides: Partial<{
    id: string;
    expiresAt: Date;
  }> = {}
) => ({
  createdAt: new Date(),
  expiresAt: overrides.expiresAt ?? faker.date.future(),
  id: overrides.id ?? nanoid(),
  token: nanoid(),
  updatedAt: new Date(),
  userId,
});
