import { render } from "@react-email/render";
import { describe, expect, test } from "vitest";
import { NotificationEmail } from "../templates/notification";
import { PasswordResetEmail } from "../templates/password-reset";
import { TwoFactorOtpEmail } from "../templates/two-factor-otp";
import { VerificationOtpEmail } from "../templates/verification-otp";
import { WelcomeEmail } from "../templates/welcome";

// Snapshot tests pin the rendered HTML output of each transactional email
// template. Diffs in the snapshots make unintentional copy or layout changes
// visible during review. Each template is rendered with the same
// `PreviewProps` shape used by the React Email dev server, so the snapshot
// reflects the canonical preview state.

describe("Email template snapshots", () => {
  test("NotificationEmail renders with action button", async () => {
    const html = await render(
      <NotificationEmail
        actionLabel="View Invitation"
        actionUrl="https://example.com/shares/123"
        body="John wants to share a card ending in 4242 with you."
        subject="Card share invitation"
      />
    );
    expect(html).toMatchSnapshot();
  });

  test("NotificationEmail renders without action button", async () => {
    const html = await render(
      <NotificationEmail
        body="Just letting you know your statement is ready."
        subject="Statement ready"
      />
    );
    expect(html).toMatchSnapshot();
  });

  test("PasswordResetEmail renders", async () => {
    const html = await render(
      <PasswordResetEmail
        expiresIn="60 minutes"
        resetUrl="https://example.com/reset?token=abc123"
        userName="Ada"
      />
    );
    expect(html).toMatchSnapshot();
  });

  test("TwoFactorOtpEmail renders with device metadata", async () => {
    const html = await render(
      <TwoFactorOtpEmail
        expiresIn="3 minutes"
        ipAddress="192.168.1.1"
        otp="123456"
        userAgent="Chrome on macOS"
        userName="Ada"
      />
    );
    expect(html).toMatchSnapshot();
  });

  test("TwoFactorOtpEmail renders without device metadata", async () => {
    const html = await render(
      <TwoFactorOtpEmail expiresIn="3 minutes" otp="654321" userName="Ada" />
    );
    expect(html).toMatchSnapshot();
  });

  test.each([
    "sign-in",
    "email-verification",
    "forget-password",
  ] as const)("VerificationOtpEmail renders for type %s", async (type) => {
    const html = await render(
      <VerificationOtpEmail
        expiresIn="10 minutes"
        otp="123456"
        type={type}
        userName="Ada"
      />
    );
    expect(html).toMatchSnapshot();
  });

  test("WelcomeEmail renders", async () => {
    const html = await render(
      <WelcomeEmail loginUrl="https://example.com/login" userName="Ada" />
    );
    expect(html).toMatchSnapshot();
  });
});
