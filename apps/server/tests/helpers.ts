export const parseResponse = <T>(response: {
  json: () => Promise<T>;
}): Promise<T> => response.json();

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export const expectError = (
  response: ErrorResponse,
  expectedCode: string
): void => {
  if (response.success !== false) {
    throw new Error("Expected error response but got success");
  }

  if (response.error.code !== expectedCode) {
    throw new Error(
      `Expected error code "${expectedCode}" but got "${response.error.code}"`
    );
  }
};

// SAFETY: tests supply only the bindings exercised by their code path; the remaining CloudflareBindings members are never read.
export const testBindings = <T>(bindings: T): CloudflareBindings & T =>
  bindings as CloudflareBindings & T;
