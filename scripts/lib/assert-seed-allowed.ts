// Safety guard for the `seed-dev` CLI entrypoint: refuses to run unless
// NODE_ENV is development/test (or `--allow-non-dev`) AND the connection
// string looks local. Pure function so it can be unit-tested directly.

export type AssertSeedAllowedInput = Readonly<{
  nodeEnv: string | undefined;
  argv: readonly string[];
  connectionString: string | undefined;
}>;

export type AssertSeedAllowedResult =
  | { ok: true }
  | { ok: false; reason: string };

const LOCAL_HOST_MARKERS = [
  "localhost",
  "127.0.0.1",
  ".local",
  "host.docker.internal",
] as const;

function looksLocal(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  return LOCAL_HOST_MARKERS.some((marker) => lower.includes(marker));
}

export function assertSeedAllowed(
  input: AssertSeedAllowedInput
): AssertSeedAllowedResult {
  const { nodeEnv, argv, connectionString } = input;
  const isDevEnv = nodeEnv === "development" || nodeEnv === "test";
  const allowOverride = argv.includes("--allow-non-dev");
  if (!(isDevEnv || allowOverride)) {
    return {
      ok: false,
      reason:
        `seed-dev: refusing to run with NODE_ENV="${nodeEnv ?? ""}". ` +
        'Set NODE_ENV to "development" or "test", or pass --allow-non-dev explicitly.',
    };
  }
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    return {
      ok: false,
      reason:
        "seed-dev: refusing to run without a connection string (DATABASE_URL).",
    };
  }
  if (!looksLocal(connectionString)) {
    return {
      ok: false,
      reason:
        "seed-dev: refusing to run against a non-local connection string. " +
        "Expected one of localhost, 127.0.0.1, .local, or host.docker.internal in DATABASE_URL.",
    };
  }
  return { ok: true };
}
