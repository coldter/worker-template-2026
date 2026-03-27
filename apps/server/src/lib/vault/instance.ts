import { env } from "cloudflare:workers";
import { apiKeySchema, secretSchema } from "./schemas";
import type { ProviderConfig } from "./types";
import { Vault } from "./vault";

function buildProviderConfig(): ProviderConfig {
  const key = env.VAULT_MASTER_KEY;
  if (!key) {
    throw new Error("VAULT_MASTER_KEY is required");
  }
  return { provider: "local", masterKey: key };
}

let _vault: Vault | null = null;

export function getVault(): Vault {
  if (!_vault) {
    const config = buildProviderConfig();
    _vault = new Vault(config);
    _vault.registerSchema(apiKeySchema).registerSchema(secretSchema);
  }
  return _vault;
}

export const vault = {
  get instance(): Vault {
    return getVault();
  },
  encrypt: (
    ...args: Parameters<Vault["encrypt"]>
  ): ReturnType<Vault["encrypt"]> => getVault().encrypt(...args),
  decrypt: (
    ...args: Parameters<Vault["decrypt"]>
  ): ReturnType<Vault["decrypt"]> => getVault().decrypt(...args),
  encryptRaw: (...args: Parameters<Vault["encryptRaw"]>) =>
    getVault().encryptRaw(...args),
  decryptRaw: (...args: Parameters<Vault["decryptRaw"]>) =>
    getVault().decryptRaw(...args),
  hash: (...args: Parameters<Vault["hash"]>) => getVault().hash(...args),
  verifyHash: (...args: Parameters<Vault["verifyHash"]>) =>
    getVault().verifyHash(...args),
};
