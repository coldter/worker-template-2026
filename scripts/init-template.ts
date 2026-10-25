#!/usr/bin/env bun

import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

declare const prompt: (message: string, defaultValue?: string) => string | null;

const ROOT = path.resolve(import.meta.dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

const APP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const PACKAGE_SCOPE_PATTERN = /^@[a-z0-9][a-z0-9-]*$/u;
const EMAIL_PATTERN = /.+@.+\..+/u;
const SCOPE_PATTERN = /@repo\//gu;
const ROOT_NAME_PATTERN = /"name"\s*:\s*"repo"/gu;
const QUOTE_OR_SPACE_PATTERN = /\s|"/u;
const QUOTE_PATTERN = /"/gu;
const README_HEADING_PATTERN = /^#\s+.*$/mu;
const YES_PATTERN = /^(?:y|yes)$/iu;

const WORKER_APPS = ["server", "auth", "web"] as const;

interface Answers {
  appName: string;
  packageScope: string;
  companyName: string;
  supportEmail: string;
  renameWorkers: boolean;
}

const SCAN_DIRS = ["apps", "packages"];
const FILE_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".jsonc"]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  ".git",
  "coverage",
  ".cache",
  "api.gen",
  "ref-project",
  ".wrangler",
  ".alchemy",
]);

const ask = (
  message: string,
  validator?: (v: string) => string | undefined
): string => {
  while (true) {
    const raw = prompt(message);
    const answer = (raw ?? "").trim();
    const error = validator?.(answer);

    if (error) {
      console.error(`  ${error}`);
      continue;
    }

    return answer;
  }
};

const askYesNo = (message: string, defaultYes: boolean): boolean => {
  const suffix = defaultYes ? " [Y/n]: " : " [y/N]: ";
  const raw = prompt(`${message}${suffix}`);
  const answer = (raw ?? "").trim();

  if (!answer) {
    return defaultYes;
  }

  return YES_PATTERN.test(answer);
};

const validateAppName = (value: string): string | undefined => {
  if (!value) {
    return "App name is required.";
  }

  if (!APP_NAME_PATTERN.test(value)) {
    return "App name must be lowercase letters, numbers, and dashes only.";
  }
};

const validatePackageScope = (value: string): string | undefined => {
  if (!value) {
    return "Package scope is required.";
  }

  if (!PACKAGE_SCOPE_PATTERN.test(value)) {
    return "Package scope must start with '@' followed by lowercase letters, numbers, and dashes.";
  }
};

const validateEmail = (value: string): string | undefined => {
  if (!value) {
    return "Email is required.";
  }

  if (!EMAIL_PATTERN.test(value)) {
    return "Invalid email address.";
  }
};

const gatherAnswers = (): Answers => {
  console.info("Template initializer");
  console.info("--------------------");
  const appName = ask("App name (lowercase, e.g. my-app): ", validateAppName);

  const packageScope = ask(
    "Package scope (e.g. @my-app): ",
    validatePackageScope
  );

  const companyName = ask("Company name (e.g. Acme Inc.): ", (v) =>
    v ? undefined : "Company name is required."
  );

  const supportEmail = ask(
    "Support email (e.g. support@example.com): ",
    validateEmail
  );

  const renameWorkers = askYesNo(
    `Prefix Cloudflare Worker names with "${appName}-" in each wrangler.jsonc? (deployed worker names will be "${appName}-server", "${appName}-auth", "${appName}-web")`,
    true
  );

  return { appName, companyName, packageScope, renameWorkers, supportEmail };
};

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          return [];
        }

        return walk(full);
      }

      if (entry.isFile()) {
        return [full];
      }

      return [];
    })
  );

  return files.flat();
};

const walkWithExtensions = (dir: string): Promise<string[]> =>
  walk(dir).then((files) =>
    files.filter((file) =>
      FILE_EXTENSIONS.has(file.slice(file.lastIndexOf(".")))
    )
  );

const collectTargetFiles = async (): Promise<string[]> => {
  const candidates = await Promise.all(
    SCAN_DIRS.map(async (dir) => {
      const abs = path.join(ROOT, dir);

      try {
        await stat(abs);

        return abs;
      } catch {
        return null;
      }
    })
  );

  const existingDirs = candidates.filter((dir): dir is string => dir !== null);
  const nestedFiles = await Promise.all(existingDirs.map(walkWithExtensions));

  return [nestedFiles.flat(), path.join(ROOT, "package.json")].flat();
};

const rewriteFile = async (
  file: string,
  transform: (content: string) => string
): Promise<boolean> => {
  const original = await readFile(file, "utf-8");
  const updated = transform(original);

  if (updated === original) {
    return false;
  }

  if (DRY_RUN) {
    console.info(`  would update ${path.relative(ROOT, file)}`);
  } else {
    await writeFile(file, updated, "utf-8");
    console.info(`  updated ${path.relative(ROOT, file)}`);
  }

  return true;
};

const makeReplacer =
  (answers: Answers) =>
  (content: string, file: string): string => {
    let next = content.replaceAll(SCOPE_PATTERN, `${answers.packageScope}/`);

    if (file === path.join(ROOT, "package.json")) {
      next = next.replaceAll(ROOT_NAME_PATTERN, `"name": "${answers.appName}"`);
    }

    return next;
  };

const renameWorkerInWranglerConfig = (
  content: string,
  appName: string
): string => {
  let next = content;

  for (const worker of WORKER_APPS) {
    const namePattern = new RegExp(`"name"\\s*:\\s*"${worker}"`, "gu");
    next = next.replaceAll(namePattern, `"name": "${appName}-${worker}"`);

    const servicePattern = new RegExp(`"service"\\s*:\\s*"${worker}"`, "gu");
    next = next.replaceAll(servicePattern, `"service": "${appName}-${worker}"`);
  }

  return next;
};

const renameWorkerNames = async (answers: Answers): Promise<void> => {
  if (!answers.renameWorkers) {
    console.info(
      "  skipping wrangler.jsonc worker rename (run manually later if desired)"
    );

    return;
  }

  await Promise.all(
    WORKER_APPS.map(async (worker) => {
      const filePath = path.join(ROOT, "apps", worker, "wrangler.jsonc");

      try {
        await stat(filePath);
      } catch {
        return;
      }

      await rewriteFile(filePath, (content) =>
        renameWorkerInWranglerConfig(content, answers.appName)
      );
    })
  );
};

const setEnvVar = (content: string, key: string, value: string): string => {
  const pattern = new RegExp(`^(\\s*)${key}=.*$`, "gmu");

  if (!pattern.test(content)) {
    return content;
  }

  pattern.lastIndex = 0;

  return content.replace(pattern, (_match, indent: string) => {
    const needsQuotes = QUOTE_OR_SPACE_PATTERN.test(value);

    const safe = needsQuotes
      ? `"${value.replaceAll(QUOTE_PATTERN, '\\"')}"`
      : value;

    return `${indent}${key}=${safe}`;
  });
};

const updateEnvExample = async (
  filePath: string,
  answers: Answers
): Promise<void> => {
  try {
    await stat(filePath);
  } catch {
    return;
  }

  await rewriteFile(filePath, (content) => {
    let next = content;
    next = setEnvVar(next, "APP_NAME", answers.appName);
    next = setEnvVar(next, "COMPANY_NAME", answers.companyName);
    next = setEnvVar(next, "SUPPORT_EMAIL", answers.supportEmail);
    next = setEnvVar(next, "LOGO_TEXT", answers.appName);
    next = setEnvVar(next, "VITE_APP_NAME", answers.appName);
    next = setEnvVar(next, "VITE_COMPANY_NAME", answers.companyName);
    next = setEnvVar(next, "VITE_SUPPORT_EMAIL", answers.supportEmail);
    next = setEnvVar(next, "VITE_LOGO_TEXT", answers.appName);

    return next;
  });
};

const setJsonStringVar = (
  content: string,
  key: string,
  value: string
): string => {
  const pattern = new RegExp(`^(\\s*)"${key}"\\s*:\\s*"[^"]*"`, "gmu");

  return content.replaceAll(
    pattern,
    (_match, indent: string) => `${indent}"${key}": ${JSON.stringify(value)}`
  );
};

const updateWranglerBrandVars = async (answers: Answers): Promise<void> => {
  const replacements = {
    APP_NAME: answers.appName,
    COMPANY_NAME: answers.companyName,
    LOGO_TEXT: answers.appName,
    SUPPORT_EMAIL: answers.supportEmail,
  } satisfies Record<string, string>;

  await Promise.all(
    WORKER_APPS.map(async (worker) => {
      const filePath = path.join(ROOT, "apps", worker, "wrangler.jsonc");

      try {
        await stat(filePath);
      } catch {
        return;
      }

      await rewriteFile(filePath, (content) => {
        let next = content;

        for (const [key, value] of Object.entries(replacements)) {
          next = setJsonStringVar(next, key, value);
        }

        return next;
      });
    })
  );
};

const updateReadme = async (answers: Answers): Promise<void> => {
  const readmePath = path.join(ROOT, "README.md");

  try {
    await stat(readmePath);
  } catch {
    return;
  }

  await rewriteFile(readmePath, (content) =>
    content.replace(README_HEADING_PATTERN, `# ${answers.appName}`)
  );
};

interface PackageJson {
  scripts?: Record<string, string>;
}

const removeSelf = async (): Promise<void> => {
  const self = import.meta.filename;
  const pkgPath = path.join(ROOT, "package.json");

  if (DRY_RUN) {
    console.info(`  would delete ${path.relative(ROOT, self)}`);
    console.info(`  would remove "template:init" script from package.json`);

    return;
  }

  const pkgRaw = await readFile(pkgPath, "utf-8");
  const pkg: PackageJson = JSON.parse(pkgRaw);

  if (pkg.scripts && "template:init" in pkg.scripts) {
    const { "template:init": _removed, ...rest } = pkg.scripts;
    pkg.scripts = rest;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
    console.info("  removed template:init script from package.json");
  }

  await unlink(self);
  console.info(`  deleted ${path.relative(ROOT, self)}`);
};

const main = async (): Promise<void> => {
  const answers = gatherAnswers();
  console.info("");
  console.info(
    DRY_RUN ? "Dry run -- no files will be written." : "Applying changes..."
  );

  const files = await collectTargetFiles();
  const replace = makeReplacer(answers);

  const results = await Promise.all(
    files.map((file) => rewriteFile(file, (content) => replace(content, file)))
  );

  const touched = results.filter(Boolean).length;
  console.info(`Rewrote scope/name in ${touched} files.`);

  console.info("Updating wrangler.jsonc worker names...");
  await renameWorkerNames(answers);

  console.info("Updating wrangler.jsonc brand vars...");
  await updateWranglerBrandVars(answers);

  console.info("Updating env examples...");
  await updateEnvExample(path.join(ROOT, ".env.example"), answers);

  console.info("Updating README...");
  await updateReadme(answers);

  console.info("Cleaning up template scaffolding...");
  await removeSelf();

  console.info("");
  console.info("Done. Next steps:");
  console.info("  1. bun install");
  console.info(
    "  2. bash scripts/setup-env.sh   # populate .dev.vars from .env"
  );
  console.info("  3. bun run db:push");
  console.info("  4. bun run dev");
};

try {
  await main();
} catch (error) {
  console.error("Template init failed:", error);
  process.exit(1);
}
