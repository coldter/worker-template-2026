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
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(STUB_SOURCE)}`,
    };
  }
  return nextResolve(specifier, context);
}
