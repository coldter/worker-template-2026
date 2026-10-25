import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod/mini";

import { Authorized } from "@/components/authorized";
import { authorizationCapabilitiesQueryOptions } from "@/hooks/use-authorization";
import { PermissionDenied } from "@/modules/permissions";
import { UsersPage } from "@/modules/users/pages/users-page";
import { usersListQueryOptions } from "@/modules/users/query";

const catchSchema = z.catch;

export const usersSearchSchema = z.object({
  order: catchSchema(z.optional(z.enum(["asc", "desc"])), undefined),
  page: catchSchema(z.optional(z.number()), 1),
  perPage: catchSchema(z.optional(z.number()), 20),
  role: z.optional(z.string()),
  search: z.optional(z.string()),
  sort: z.optional(z.string()),
  status: catchSchema(
    z.optional(z.enum(["active", "inactive", "locked"])),
    undefined
  ),
});

export type UsersSearch = z.infer<typeof usersSearchSchema>;

const usersListParams = (search: UsersSearch) => ({
  order: search.order ?? ("desc" as const),
  page: Math.max(1, search.page ?? 1),
  perPage: search.perPage ?? 20,
  role: search.role,
  search: search.search,
  sort: search.sort ?? "createdAt",
  status: search.status,
});

export const Route = createFileRoute("/(protected)/users/")({
  component: () => (
    <Authorized
      capability="user:list"
      fallback={<PermissionDenied requiredPermission="user:list" />}
    >
      <UsersPage />
    </Authorized>
  ),
  loader: async ({ context, deps }) => {
    const { queryClient } = context;

    const capabilities = queryClient.getQueryData(
      authorizationCapabilitiesQueryOptions().queryKey
    );

    if (capabilities?.["user:list"]) {
      await queryClient.prefetchQuery(
        usersListQueryOptions(usersListParams(deps))
      );
    }
  },
  loaderDeps: ({ search }) => search,
  validateSearch: (search) => usersSearchSchema.parse(search),
});
