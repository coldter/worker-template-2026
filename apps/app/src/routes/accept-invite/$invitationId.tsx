// `/accept-invite/:invitationId` — public route, OUTSIDE `(protected)` (D48).
// Better Auth invitation acceptance is orchestrated by `apps/server` at
// `POST /api/invitations/accept/:invitationId` (B2). The server completes
// the BA flow, sets the session cookie, and returns the post-accept
// redirect target.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/accept-invite/$invitationId")({
  component: AcceptInviteRoute,
});

function AcceptInviteRoute() {
  const { invitationId } = Route.useParams();
  const navigate = useNavigate();
  return <AcceptInviteForm invitationId={invitationId} navigate={navigate} />;
}

type Navigate = (opts: { to: string }) => void;

export function AcceptInviteForm({
  invitationId,
  navigate,
}: {
  invitationId: string;
  navigate: Navigate;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await fetch(`/api/invitations/accept/${invitationId}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, password }),
        });
        if (r.ok) {
          // boundary: server response shape narrowed at the trust boundary.
          const j = (await r.json()) as { redirectTo: string };
          navigate({ to: j.redirectTo });
        }
      }}
    >
      <label htmlFor="invite-name">Name</label>
      <input
        id="invite-name"
        onChange={(e) => setName(e.target.value)}
        value={name}
      />
      <label htmlFor="invite-password">Password</label>
      <input
        id="invite-password"
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        value={password}
      />
      <button type="submit">Accept</button>
    </form>
  );
}
