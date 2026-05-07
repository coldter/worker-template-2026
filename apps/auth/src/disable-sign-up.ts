import type {
  BetterAuthOptions,
  GenericEndpointContext,
  User,
} from "better-auth";
import { APIError } from "better-auth/api";

type BeforeFn = NonNullable<
  NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>["create"]
>["before"];

export type DisableSignUpHookResult = {
  create: {
    before: NonNullable<BeforeFn>;
  };
};

/**
 * Defense-in-depth hook: rejects public sign-up at the database layer.
 * Runs alongside emailAndPassword.disableSignUp for belt-and-suspenders.
 * The admin createUser path bypasses this check because ctx.context.session.user
 * is populated by the admin-authenticated request.
 *
 * Role-assignment defaults (roleSlugs, status, etc.) MUST be applied in the
 * caller's hook after this check so the admin path still receives them.
 */
export function disableSignUpHook(): DisableSignUpHookResult {
  return {
    create: {
      before: async (user, ctx: GenericEndpointContext | null) => {
        // boundary: BA's GenericEndpointContext.context.session is typed as
        // `Session | null` but the admin createUser path attaches a richer
        // session whose user shape isn't surfaced in the public types.
        const session = (
          ctx as { context?: { session?: { user?: unknown } } } | null
        )?.context?.session;
        const isAdminPath = session?.user != null;
        if (!isAdminPath) {
          throw new APIError("FORBIDDEN", { message: "Sign-up is disabled" });
        }
        // boundary: BA databaseHooks return `{ data: user }` with `user`
        // typed via the adapter's generic; preserving extra fields requires
        // widening to a record.
        return { data: user as User & Record<string, unknown> };
      },
    },
  };
}
