import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { readFileSync } from "node:fs";
import { URL } from "node:url";
import { promisify } from "node:util";

import type { UserConfig } from "@hey-api/openapi-ts";
import type { Plugin, ViteDevServer } from "vite";
import * as z from "zod/mini";

import { openApiConfig } from "../openapi-ts.config.ts";

const execAsync = promisify(exec);

const isValidUrl = (str: string) => {
  try {
    return new URL(str) instanceof URL;
  } catch {
    return false;
  }
};

const fileExists = (path: string) => {
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
};

const stringPathSchema = z.string();
const objectPathSchema = z.object({ path: z.string() });

const validateConfigPath = (path: string): string => {
  if (!fileExists(path)) {
    throw new Error("Invalid path in openapi Config");
  }

  if (isValidUrl(path)) {
    throw new Error("Input path is a URL in openapi Config");
  }

  return path;
};

const getConfigInputPath = (
  config: UserConfig["input"] | UserConfig["output"]
): string => {
  const objectPath = objectPathSchema.safeParse(config);

  if (objectPath.success) {
    return validateConfigPath(objectPath.data.path);
  }

  const stringPath = stringPathSchema.safeParse(config);

  if (!stringPath.success) {
    throw new Error("Path missing path in openapi Config");
  }

  return validateConfigPath(stringPath.data);
};

export const watchBackendOpenApi = (): Plugin => {
  let inputFilePath: string;
  let outputPath: string;
  let viteServer: ViteDevServer | null = null;

  const hashFile = () => {
    const content = readFileSync(inputFilePath);

    return createHash("sha256").update(content).digest("hex");
  };

  let previousHash = "";
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;

  const regenerateClient = async () => {
    const chokidarWatcher = viteServer?.watcher;
    chokidarWatcher?.unwatch(outputPath);

    try {
      const { stdout, stderr } = await execAsync("bun run generate-client");
      console.info("[openapi-ts] Regenerated typings:\n", stdout || stderr);
    } catch (error) {
      console.error("[openapi-ts] Error:", error);
    } finally {
      chokidarWatcher?.add(outputPath);
      viteServer?.ws.send({ type: "full-reload" });
    }
  };

  return {
    apply: "serve",

    buildStart() {
      if (!(inputFilePath && outputPath)) {
        return;
      }

      if (watcher) {
        watcher.close();
        watcher = null;
      }

      watcher = fs.watch(inputFilePath, (eventType) => {
        if (eventType === "change") {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          debounceTimer = setTimeout(() => {
            try {
              const newHash = hashFile();

              if (newHash !== previousHash) {
                previousHash = newHash;

                void regenerateClient();
              }
            } catch (error) {
              console.error("[openapi-ts] Failed to read or hash file:", error);
            }
          }, 100);
        }
      });
    },

    closeBundle() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
    configureServer(server) {
      viteServer = server;
      inputFilePath = getConfigInputPath(openApiConfig.input);
      outputPath = getConfigInputPath(openApiConfig.output);
      previousHash = hashFile();
    },
    name: "watch-backend-openapi",
  };
};
