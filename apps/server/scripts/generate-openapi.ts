import { register } from "node:module";

// Stub cloudflare:* imports so the server module can be loaded under Node/tsx
register("./cloudflare-stub-hooks.mjs", import.meta.url);

process.env.SKIP_DB = "true";

/**
 * Generate OpenAPI documentation and save it to a file.
 *
 * This script initializes the OpenAPI documentation for the application,
 * registers necessary schemas, and writes the generated OpenAPI document
 * to a JSON file.
 */
(async () => {
  try {
    const [{ default: app }, { setupDocs }] = await Promise.all([
      import("../src/server"),
      import("../src/lib/docs"),
    ]);

    setupDocs(app);
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
