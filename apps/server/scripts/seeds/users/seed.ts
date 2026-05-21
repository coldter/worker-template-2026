import { createAccountId, createUserId } from "@repo/db/ids";
import { accounts, users } from "@repo/db/schema";
import { hashPassword } from "better-auth/crypto";
import chalk from "chalk";
import { SYSTEM_ROLES } from "@/modules/roles";
import { defaultAdminUser } from "../fixtures";
import { db, isUserSeeded } from "../utils";

export const userSeed = async () => {
  if (process.env.NODE_ENV === "production") {
    console.error("Not allowed in production.");
    return;
  }

  if (await isUserSeeded()) {
    console.warn("Users table is not empty - skipping seed");
    return;
  }

  const userId = createUserId();
  const hashedPassword = await hashPassword(defaultAdminUser.password);

  const [user] = await db
    .insert(users)
    .values({
      id: userId,
      email: defaultAdminUser.email,
      name: defaultAdminUser.name,
      emailVerified: true,
      status: "active",
      roleSlugs: [SYSTEM_ROLES.ADMIN.slug],
      failedLoginAttempts: 0,
    })
    .returning();

  if (!user) {
    console.error("Failed to create admin user");
    return;
  }

  await db.insert(accounts).values({
    id: createAccountId(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: hashedPassword,
  });

  console.info(
    `\nCreated admin user with email ${chalk.greenBright.bold(user.email)} and password ${chalk.greenBright.bold(defaultAdminUser.password)}.\n`
  );
  console.info(`  Role: ${chalk.cyan(SYSTEM_ROLES.ADMIN.slug)}`);
  console.info(`  Status: ${chalk.green("active")}\n`);
};
