# Configuration and Usage

## Transport

The package uses Resend for email delivery. There is no `EMAIL_PROVIDER` env toggle; the only transport is Resend.

Pass `apiKey` (your `RESEND_API_KEY`) directly to `sendEmail` — do not instantiate `Resend` yourself.

## Usage Pattern

```typescript
import { sendEmail, WelcomeEmail } from "@repo/email";

const result = await sendEmail({
  apiKey: env.RESEND_API_KEY,
  from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
  to: user.email,
  subject: "Welcome!",
  template: WelcomeEmail,
  props: { userName: user.name ?? "there", loginUrl: env.APP_URL },
});

if (!result.success) {
  logger.error("email send failed", { error: result.error?.message });
}
```

## SendEmailParams

| Field | Type | Description |
| --- | --- | --- |
| `apiKey` | `string` | Resend API key |
| `from` | `string` | Sender address, e.g. `"Name <no-reply@example.com>"` |
| `to` | `string \| string[]` | Recipient(s) |
| `subject` | `string` | Email subject line |
| `template` | `(props: T) => ReactElement` | React Email template component |
| `props` | `T` | Typed props passed to the template |

`sendEmail` returns `{ success: true }` or `{ success: false, error: Error }`. Handle both cases explicitly.
