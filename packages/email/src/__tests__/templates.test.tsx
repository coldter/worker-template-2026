import { render } from "@react-email/render";
import { describe, expect, test } from "vitest";
import { NotificationEmail } from "../templates/notification";
import { PasswordResetEmail } from "../templates/password-reset";
import { TwoFactorOtpEmail } from "../templates/two-factor-otp";
import { VerificationOtpEmail } from "../templates/verification-otp";
import { WelcomeEmail } from "../templates/welcome";

describe("Email templates", () => {
  test("NotificationEmail renders with brand overrides", async () => {
    const html = await render(
      <NotificationEmail
        actionLabel="View"
        actionUrl="https://example.com/x"
        body="Branded body"
        brand={{
          appName: "Acme",
          companyName: "Acme Corp",
          primaryColor: "#123456",
          supportEmail: "help@acme.test",
        }}
        subject="Branded subject"
      />
    );

    expect(html).toContain("ACME");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("help@acme.test");
    expect(html).toContain("rgb(18,52,86)");
  });

  test("PasswordResetEmail renders the user name and reset link", async () => {
    const html = await render(
      <PasswordResetEmail
        expiresIn="60 minutes"
        resetUrl="https://example.com/reset?token=abc123"
        userName="Ada"
      />
    );

    expect(html).toContain("Ada");
    expect(html).toContain("https://example.com/reset?token=abc123");
  });

  test("TwoFactorOtpEmail renders the code and device metadata", async () => {
    const html = await render(
      <TwoFactorOtpEmail
        expiresIn="3 minutes"
        ipAddress="192.168.1.1"
        otp="123456"
        userAgent="Chrome on macOS"
        userName="Ada"
      />
    );

    expect(html).toContain("123456");
    expect(html).toContain("Chrome on macOS");
  });

  test("VerificationOtpEmail renders the type-specific title and code", async () => {
    const html = await render(
      <VerificationOtpEmail
        expiresIn="10 minutes"
        otp="123456"
        type="email-verification"
        userName="Ada"
      />
    );

    expect(html).toContain("Verify Your Email");
    expect(html).toContain("123456");
  });

  test("WelcomeEmail renders the user name and login link", async () => {
    const html = await render(
      <WelcomeEmail loginUrl="https://example.com/login" userName="Ada" />
    );

    expect(html).toContain("Ada");
    expect(html).toContain("https://example.com/login");
  });
});
