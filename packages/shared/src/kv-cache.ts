export const kvGetJson = async <T>(
  kv: KVNamespace,
  key: string
): Promise<T | null> => {
  const raw = await kv.get(key, "text");

  if (!raw) {
    return null;
  }

  try {
    // SAFETY: kvSetJson serializes the caller's T for this key, so the stored payload parses back as T.
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const kvSetJson = async <T>(
  kv: KVNamespace,
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<void> => {
  await kv.put(
    key,
    JSON.stringify(value),
    ttlSeconds ? { expirationTtl: Math.max(ttlSeconds, 60) } : undefined
  );
};

export const kvDelete = async (kv: KVNamespace, key: string): Promise<void> => {
  await kv.delete(key);
};
