import { describe, expect, it, vi } from "vitest";
import { applyBranding } from "@/lib/branding";

describe("applyBranding", () => {
  it("sets --brand-primary via setProperty (CSP-safe), never injects <style>", () => {
    const setProperty = vi.fn();
    const appendChild = vi.fn();
    const documentMock = {
      documentElement: { style: { setProperty } },
      title: "",
      head: { appendChild },
    };
    vi.stubGlobal("document", documentMock);

    applyBranding({ primaryColor: "#3366ff", appName: "Acme" });
    expect(setProperty).toHaveBeenCalledWith("--brand-primary", "#3366ff");
    expect(documentMock.title).toBe("Acme");
    expect(appendChild).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
