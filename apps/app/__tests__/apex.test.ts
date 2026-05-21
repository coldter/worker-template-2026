// Apex page is served as a static asset on the apex of `APP_WILDCARD_HOST`.
// Vite copies `public/apex/index.html` into `dist/apex/index.html` during
// build. The "source of truth" assertion runs against `public/`; the
// post-build check is gated on `dist/` existing so this suite stays green
// without a build step.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname);
const appRoot = path.resolve(here, "..");

describe("apex page", () => {
  it("public/apex/index.html exists and contains 'Find your team'", () => {
    const src = path.join(appRoot, "public", "apex", "index.html");
    expect(fs.existsSync(src)).toBe(true);
    const html = fs.readFileSync(src, "utf8");
    expect(html).toContain("Find your team");
  });

  it("dist/apex/index.html exists when the SPA has been built", () => {
    const dist = path.join(appRoot, "dist", "apex", "index.html");
    if (!fs.existsSync(dist)) {
      // No build artifact yet — the build step is gated on CI/dev. The
      // public/ source assertion above already guards content.
      return;
    }
    const html = fs.readFileSync(dist, "utf8");
    expect(html).toContain("Find your team");
  });
});
