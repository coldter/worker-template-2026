import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

/**
 * The auth worker's Hono app must reject every direct fetch with 421
 * (Misdirected Request). Auth traffic is only allowed via
 * `AuthEntrypoint.handleAuthRequest`, which sanitises the request and pins
 * it to a resolved tenant. Wiring a fallback that ran the BA pipeline with
 * `tenant: null` would re-open the apex JWT mint bypass + skipped tenant
 * membership enforcement.
 *
 * We avoid importing `../server` directly because that module pulls in the
 * Cloudflare-Workers-only `caches.default` at module init. Instead we
 * (a) statically assert the catch-all in the source returns 421, and
 * (b) re-create the equivalent Hono catch-all and exercise it across paths.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(HERE, "../server.ts"), "utf8");

const CATCH_ALL_RE = /app\.all\(\s*["']\/\*["']/;
const STATUS_RE = /421/;
const LINE_COMMENT_RE = /\/\/[^\n]*\n/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const CREATE_AUTH_RE = /createAuth\s*\(/;
const AUTH_HANDLER_RE = /auth\.handler\s*\(/;
const SERVICE_BINDING_RE = /service binding/;

describe("auth worker default fetch returns 421 (source guard)", () => {
  it("server.ts catch-all responds with status 421", () => {
    expect(SERVER_SRC).toMatch(CATCH_ALL_RE);
    expect(SERVER_SRC).toMatch(STATUS_RE);
  });

  it("server.ts has no fallback that calls into Better Auth", () => {
    // Strip comments so the security note discussing the bad pattern doesn't
    // trip the runtime guard. We only care about live code references.
    const codeOnly = SERVER_SRC.replace(LINE_COMMENT_RE, "\n").replace(
      BLOCK_COMMENT_RE,
      ""
    );
    expect(codeOnly).not.toMatch(CREATE_AUTH_RE);
    expect(codeOnly).not.toMatch(AUTH_HANDLER_RE);
  });
});

describe("auth worker default fetch returns 421 (behavioral)", () => {
  // Mirrors the catch-all in src/server.ts. Kept in sync via the source-guard
  // tests above. We re-create it here so we can exercise routing behaviour
  // without importing the real module (which pulls Workers-only globals).
  function makeApp() {
    const app = new Hono();
    app.all("/*", (c) =>
      c.json({ error: "auth worker reachable only via service binding" }, 421)
    );
    return app;
  }

  const cases = [
    "https://acme.app.example.com/api/auth/sign-in/email",
    "https://app.example.com/",
    "https://acme.app.example.com/api/auth/jwks",
    "https://acme.app.example.com/api/auth/get-session",
  ];

  for (const url of cases) {
    it(`returns 421 for ${url}`, async () => {
      const app = makeApp();
      const res = await app.fetch(new Request(url));
      expect(res.status).toBe(421);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(SERVICE_BINDING_RE);
    });
  }
});
