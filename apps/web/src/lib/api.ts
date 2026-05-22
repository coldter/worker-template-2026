import { clientConfig } from "@/lib/utils";

export class ApiError extends Error {
  error: {
    message?: string;
  };
  status: number;
  path?: string;

  constructor(
    error: { error: { message?: string }; name?: string },
    status?: number
  ) {
    super(error.error.message);
    this.name = error.name ?? "ApiError";
    this.error = error.error;
    this.status = status ?? 500;
  }

  static is(e: unknown): e is ApiError {
    return e instanceof ApiError;
  }
}

export { clientConfig };
