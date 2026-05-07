import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptInviteForm } from "@/routes/accept-invite/$invitationId";

const NAME_LABEL = /name/i;
const PASSWORD_LABEL = /password/i;
const ACCEPT_BUTTON = /accept/i;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AcceptInviteForm", () => {
  it("POSTs name+password to /api/invitations/accept/:id and redirects on 200", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ redirectTo: "/dashboard" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    render(<AcceptInviteForm invitationId="inv_1" navigate={navigate} />);
    fireEvent.change(screen.getByLabelText(NAME_LABEL), {
      target: { value: "Owner" },
    });
    fireEvent.change(screen.getByLabelText(PASSWORD_LABEL), {
      target: { value: "Sup3rSecret!" },
    });
    fireEvent.click(screen.getByRole("button", { name: ACCEPT_BUTTON }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/invitations/accept/inv_1",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });
});
