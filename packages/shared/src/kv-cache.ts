export async function kvGetJson<T>(
  kv: KVNamespace,
  key: string
): Promise<T | null> {
  const raw = await kv.get(key, "text");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson<T>(
  kv: KVNamespace,
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<void> {
  await kv.put(
    key,
    JSON.stringify(value),
    ttlSeconds ? { expirationTtl: Math.max(ttlSeconds, 60) } : undefined
  );
}

export async function kvDelete(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}
