// Vite's `?raw` query suffix — used by tests that assert on file contents
// without needing filesystem access at runtime. Declared in a non-module
// file (no top-level export/import) so the wildcard `declare module` is
// treated as a global ambient declaration.
declare module "*?raw" {
  const content: string;
  export default content;
}
