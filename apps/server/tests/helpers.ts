export async function parseResponse<T>(response: {
  json: () => Promise<T>;
}): Promise<T> {
  return response.json();
}

export type ErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export function expectError(
  response: ErrorResponse,
  expectedCode: string
): void {
  if (response.success !== false) {
    throw new Error("Expected error response but got success");
  }
  if (response.error.code !== expectedCode) {
    throw new Error(
      `Expected error code "${expectedCode}" but got "${response.error.code}"`
    );
  }
}

export function testBindings<T>(bindings: T): CloudflareBindings & T {
  // SAFETY: tests supply only the bindings exercised by their code path; the remaining CloudflareBindings members are never read.
  return bindings as CloudflareBindings & T;
}
