import { createRemoteJWKSet } from "jose";
import type { JWKSResolver } from "./types";

/**
 * Wraps jose's `createRemoteJWKSet` and returns it as our structural
 * `JWKSResolver`. jose memoises the JWKS internally and refreshes when an
 * unknown `kid` shows up, so per-isolate snapshot semantics fall out for
 * free: each Worker isolate that calls this gets its own jose set.
 */
export function createRemoteJwksResolver(url: URL): JWKSResolver {
  const remote = createRemoteJWKSet(url);
  // boundary: jose's resolver uses generics that don't perfectly align with
  // our structural JWKSResolver alias. The runtime shape (`(header, payload)
  // => Promise<KeyLike | Uint8Array>`) matches one-for-one.
  return remote as unknown as JWKSResolver;
}
