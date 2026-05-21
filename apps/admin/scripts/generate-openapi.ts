import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const { default: app } = await import("../src/server");
  const spec = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Admin API", version: "v1" },
  });
  const outPath = resolve(import.meta.dirname ?? ".", "../openapi.cache.json");
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  console.info(`OpenAPI spec written to ${outPath}`);
}

main().catch((err: unknown) => {
  console.error("Failed to generate admin OpenAPI cache");
  if (err instanceof Error) {
    console.error(err.stack ?? err.message);
  }
  process.exit(1);
});
