import { roles } from "@repo/db/schema";
import { getLegacyPermissionKeysForRole } from "@repo/shared/authorization";
import chalk from "chalk";
import { type PermissionKey, SYSTEM_ROLES } from "@/modules/roles";
import { db } from "../utils";

const systemRoles: Array<{
  slug: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
}> = [
  {
    ...SYSTEM_ROLES.ADMIN,
    permissions: getLegacyPermissionKeysForRole("admin"),
  },
  {
    ...SYSTEM_ROLES.USER,
    permissions: getLegacyPermissionKeysForRole("user") as PermissionKey[],
  },
];

export const rolesSeed = async () => {
  console.info("Seeding system roles...");

  for (const role of systemRoles) {
    const existingRole = await db.query.roles.findFirst({
      where: { slug: { eq: role.slug } },
    });

    if (existingRole) {
      console.info(`  Role ${chalk.cyan(role.slug)} already exists - skipping`);
      continue;
    }

    await db.insert(roles).values({
      name: role.name,
      slug: role.slug,
      description: role.description,
      permissions: role.permissions,
    });

    console.info(`  Created role ${chalk.green(role.slug)}`);
  }

  console.info(chalk.greenBright("System roles seeded successfully.\n"));
};
