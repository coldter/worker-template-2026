// Node.js module loader hooks that stub `cloudflare:*` imports.
// Used by scripts that import server code outside the Workers runtime
// (e.g., OpenAPI generation under tsx/Node).

const STUB_SOURCE = [
  "const handler = {",
  "  get(_, prop) {",
  "    if (typeof prop === 'symbol' || prop === 'then') return undefined;",
  "    if (prop === 'toString' || prop === 'valueOf') return () => '';",
  "    return new Proxy(function() {}, handler);",
  "  },",
  "  apply() { return Promise.resolve(new Proxy({}, handler)); }",
  "};",
  "export const env = new Proxy({}, handler);",
  "export class DurableObject {}",
  "export class WorkflowEntrypoint {}",
].join("\n");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("cloudflare:")) {
    return {
      url: `data:text/javascript,${encodeURIComponent(STUB_SOURCE)}`,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
