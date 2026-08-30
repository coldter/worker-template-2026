import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { resolve } from "node:path";

// Stub cloudflare:* imports so the server module can be loaded under Node/tsx
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
    const outPath = resolve(
      import.meta.dirname ?? ".",
      "../openapi.cache.json"
    );
    writeFileSync(outPath, JSON.stringify(spec, null, 2));
    console.info(`OpenAPI spec written to ${outPath}`);

    process.exit(0);
  } catch (err) {
    console.error("Failed to generate fresh OpenAPI cache");
    if (err instanceof Error) {
      console.error(err.stack || err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
})();
