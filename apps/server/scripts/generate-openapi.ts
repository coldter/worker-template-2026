import { writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";

register("./cloudflare-stub-hooks.mjs", import.meta.url);

process.env.SKIP_DB = "true";

(async () => {
  try {
    const [{ default: app }, { setupDocs }] = await Promise.all([
      import("../src/server"),
      import("../src/lib/docs"),
    ]);

    setupDocs(app);

    const spec = app.getOpenAPI31Document({
      info: { title: "Server API", version: "v1" },
      openapi: "3.1.0",
    });

    const outPath = path.resolve(
      import.meta.dirname ?? ".",
      "../openapi.cache.json"
    );

    writeFileSync(outPath, JSON.stringify(spec, null, 2));
    console.info(`OpenAPI spec written to ${outPath}`);

    process.exit(0);
  } catch (error) {
    console.error("Failed to generate fresh OpenAPI cache");

    if (error instanceof Error) {
      console.error(error.stack || error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  }
})();
