// Render a minimal "find your team" placeholder when the SPA hits an origin
// that is not associated with any tenant. The apex of `APP_WILDCARD_HOST`
// has its own static page (`public/apex/index.html`, D76); this component is
// the SPA-side fallback (e.g. a brand-new wildcard subdomain).
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
