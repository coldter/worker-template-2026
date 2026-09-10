import { kvDelete, kvGetJson, kvSetJson } from "@repo/shared/kv-cache";
import { z } from "zod";

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const counterSchema = z.number();

export function createSecondaryStorage(cache: KVNamespace) {
  return {
    delete: async (key: string) => {
      await kvDelete(cache, key);
    },
    get: async (key: string) => kvGetJson(cache, key),
    getAndDelete: async (key: string) => {
      const value = await kvGetJson(cache, key);
      if (value !== null) {
        await kvDelete(cache, key);
      }
      return value;
    },
    increment: async (key: string, ttl: number) => {
      const current = await kvGetJson(cache, key);
      const parsed = counterSchema.safeParse(current);
      const next = (parsed.success ? parsed.data : 0) + 1;
      await kvSetJson(cache, key, next, ttl).catch(() => undefined);
      return next;
    },
    set: async (key: string, value: JsonValue, ttl?: number) => {
      await kvSetJson(cache, key, value, ttl);
    },
  };
}
