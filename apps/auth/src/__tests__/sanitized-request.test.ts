import type { Tenant } from "@repo/tenancy";
import { describe, expect, it } from "vitest";
import { sanitizedAuthRequest } from "../sanitized-request";

const tenant: Tenant = {
  organizationId: "org_acme",
  slug: "acme",
  host: "acme.app.example.com",
  kind: "subdomain",
  enforceSSO: false,
  sessionVersion: 0,
  suspendedAt: null,
  deletedAt: null,
};

describe("sanitizedAuthRequest", () => {
  it("strips X-Forwarded-Host", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        "X-Forwarded-Host": "evil.example.com",
        Host: "acme.app.example.com",
      },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.headers.get("x-forwarded-host")).toBeNull();
  });

  it("strips X-Forwarded-Proto", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        "X-Forwarded-Proto": "http",
        Host: "acme.app.example.com",
      },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.headers.get("x-forwarded-proto")).toBeNull();
  });

  it("strips X-Forwarded-For", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        "X-Forwarded-For": "1.2.3.4",
        Host: "acme.app.example.com",
      },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.headers.get("x-forwarded-for")).toBeNull();
  });

  it("strips Forwarded", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        Forwarded: "for=1.2.3.4;host=evil.example.com",
        Host: "acme.app.example.com",
      },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.headers.get("forwarded")).toBeNull();
  });

  it("strips X-Forwarded-Port", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        "X-Forwarded-Port": "8443",
        Host: "acme.app.example.com",
      },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.headers.get("x-forwarded-port")).toBeNull();
  });

  it("strips CF-Connecting-IP", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        "CF-Connecting-IP": "1.2.3.4",
        Host: "acme.app.example.com",
      },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.headers.get("cf-connecting-ip")).toBeNull();
  });

  it("pins Host header to tenant.host regardless of source header", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        Host: "attacker.example.com",
        "X-Forwarded-Host": "attacker.example.com",
      },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.headers.get("host")).toBe("acme.app.example.com");
  });

  it("preserves POST body byte-for-byte", async () => {
    const body = JSON.stringify({ email: "test@example.com", password: "pw" });
    const req = new Request(
      "https://acme.app.example.com/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "acme.app.example.com",
        },
        body,
      }
    );
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(sanitized.method).toBe("POST");
    const text = await sanitized.text();
    expect(text).toBe(body);
  });

  it("does not throw when called twice on same source Request (immutability guard)", () => {
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: {
        Host: "acme.app.example.com",
        "X-Forwarded-Host": "evil.example.com",
      },
    });
    expect(() => sanitizedAuthRequest(req, tenant)).not.toThrow();
    expect(() => sanitizedAuthRequest(req, tenant)).not.toThrow();
  });

  it("sets URL protocol to https", () => {
    const req = new Request("http://acme.app.example.com/api/auth/ok", {
      headers: { Host: "acme.app.example.com" },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(new URL(sanitized.url).protocol).toBe("https:");
  });

  it("URL host is pinned to tenant.host", () => {
    const req = new Request("https://other.example.com/api/auth/ok", {
      headers: { Host: "other.example.com" },
    });
    const sanitized = sanitizedAuthRequest(req, tenant);
    expect(new URL(sanitized.url).host).toBe("acme.app.example.com");
  });
});
