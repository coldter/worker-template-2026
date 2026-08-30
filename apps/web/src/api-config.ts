import type { CreateClientConfig } from "@/api.gen/client.gen";
import { ApiError, clientConfig } from "@/lib/api";

export const createClientConfig: CreateClientConfig = (baseConfig) => ({
  ...baseConfig,
  baseUrl: import.meta.env.VITE_SERVER_URL || "http://localhost:8787",
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await clientConfig.fetch(input, init);

    if (response.ok) {
      return response;
    }

    const json = await response.json();
    throw new ApiError(json, response.status);
  },
  responseStyle: "data",
  throwOnError: true,
});
