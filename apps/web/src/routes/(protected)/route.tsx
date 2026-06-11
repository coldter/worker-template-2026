import { createFileRoute, redirect } from "@tanstack/react-router";
import { authorizationCapabilitiesQueryOptions } from "@/hooks/use-authorization";
// Deep import: the auth barrel would pull framer-motion-heavy components into
// the eager route-tree chunk (beforeLoad is not extracted by autoCodeSplitting).
import { clearSession } from "@/modules/auth/helpers";
import { AuthenticatedLayout } from "@/modules/layout/authenticated-layout";
import { sessionQueryOptions } from "@/query/session-query";
import { useAlertStore } from "@/store/alert";
import { useUserStore } from "@/store/user";

export const Route = createFileRoute("/(protected)")({
  beforeLoad: async ({ context, location }) => {
    const session =
      await context.queryClient.ensureQueryData(sessionQueryOptions);

    if (!session) {
      const previousUser = useUserStore.getState().user;

      if (previousUser) {
        useAlertStore.getState().setDownAlert("session_invalidated");
        clearSession();
      }

      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    useUserStore.getState().setUser(session.user);

    await context.queryClient.ensureQueryData(
      authorizationCapabilitiesQueryOptions()
    );

    return {
      session,
    };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  return <AuthenticatedLayout />;
}
