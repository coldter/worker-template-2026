// The apex of `APP_WILDCARD_HOST` has its own static page
// (`public/apex/index.html`); this component is the SPA-side fallback for
// wildcard subdomains that are not associated with any tenant.
import { createRoot } from "react-dom/client";

export function renderTenantNotFound(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  createRoot(root).render(
    <main>
      <h1>Find your team</h1>
      <p>This domain is not associated with a known workspace.</p>
    </main>
  );
}
