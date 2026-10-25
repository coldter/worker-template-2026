import { auditLogsSeed } from "./audit-logs/seed";
import { rolesSeed } from "./roles/seed";
import { userSeed } from "./users/seed";

const seed = async () => {
  const nodeEnv: string = process.env.NODE_ENV;

  if (nodeEnv === "production") {
    throw new Error("Refusing to seed a production database");
  }

  console.info("Starting database seeding...\n");

  await rolesSeed();
  await userSeed();
  await auditLogsSeed();

  console.info("\nDatabase seeding complete.");
};

try {
  await seed();
} catch (error) {
  console.error("Seeding failed:", error);
  process.exit(1);
} finally {
  process.exit(0);
}
