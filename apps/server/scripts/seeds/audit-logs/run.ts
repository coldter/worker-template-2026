import { auditLogsSeed } from "./seed";

try {
  await auditLogsSeed();
} catch (error) {
  console.error("Audit logs seeding failed:", error);
  process.exit(1);
} finally {
  process.exit(0);
}
