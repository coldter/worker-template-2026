import type { CreateClientConfig } from "@/api.gen/client.gen";
import { ApiError, clientConfig } from "@/lib/api";

function getResponsePath(response: Response): string | undefined {
  try {
    return new URL(response.url).pathname;
  } catch {}
}

export const createClientConfig: CreateClientConfig = (baseConfig) => ({
  ...baseConfig,
  baseUrl: import.meta.env.VITE_SERVER_URL || "http://localhost:8787",
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await clientConfig.fetch(input, init);

    if (response.ok) {
      return response;
    }

    const body = await response.json().catch(() => null);
    throw new ApiError(
      body ?? {
        error: {
          message: response.statusText || `Request failed (${response.status})`,
        },
      },
      response.status,
      getResponsePath(response)
    );
  },
  responseStyle: "data",
  throwOnError: true,
});
