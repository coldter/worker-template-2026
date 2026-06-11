import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import {
  activateUser,
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  unlockUser,
  updateUser,
  updateUserRoles,
} from "@/api.gen/sdk.gen";
import type {
  CreateUserData,
  ListUsersData,
  UpdateUserData,
  UpdateUserRolesData,
} from "@/api.gen/types.gen";

function normaliseListParams(params: ListUsersData["query"]) {
  if (!params) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

export const usersKeys = {
  all: ["users"] as const,
  lists: () => [...usersKeys.all, "list"] as const,
  list: (params: ListUsersData["query"]) =>
    [...usersKeys.lists(), normaliseListParams(params)] as const,
  details: () => [...usersKeys.all, "detail"] as const,
  detail: (id: string) => [...usersKeys.details(), id] as const,
};

export const rolesKeys = {
  all: ["roles"] as const,
  lists: () => [...rolesKeys.all, "list"] as const,
};

export function usersListQueryOptions(
  params: NonNullable<ListUsersData["query"]>
) {
  return queryOptions({
    queryKey: usersKeys.list(params),
    queryFn: async ({ signal }) => {
      const response = await listUsers({ query: params, signal });
      return response;
    },
  });
}

export function useUsersQuery(params: NonNullable<ListUsersData["query"]>) {
  return useQuery({
    ...usersListQueryOptions(params),
    placeholderData: (prev) => prev,
  });
}

export function useUserQuery(userId: string) {
  return useQuery({
    queryKey: usersKeys.detail(userId),
    queryFn: async ({ signal }) => {
      const response = await getUser({ path: { userId }, signal });
      return response.user;
    },
    enabled: Boolean(userId),
  });
}

export function useCreateUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUserData["body"]) => {
      const response = await createUser({ body: data });
      return response.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
      toast.success("User created successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create user");
    },
  });
}

export function useUpdateUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      data,
    }: {
      userId: string;
      data: UpdateUserData["body"];
    }) => {
      const response = await updateUser({ path: { userId }, body: data });
      return response.user;
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
      queryClient.invalidateQueries({ queryKey: usersKeys.detail(userId) });
      toast.success("User updated successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update user");
    },
  });
}

export function useUpdateUserRolesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      data,
    }: {
      userId: string;
      data: UpdateUserRolesData["body"];
    }) => {
      const response = await updateUserRoles({ path: { userId }, body: data });
      return response.user;
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
      queryClient.invalidateQueries({ queryKey: usersKeys.detail(userId) });
      toast.success("Roles updated successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update roles");
    },
  });
}

export function useDeactivateUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      reason,
    }: {
      userId: string;
      reason?: string;
    }) => {
      await deactivateUser({ path: { userId }, body: { reason } });
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
      queryClient.invalidateQueries({ queryKey: usersKeys.detail(userId) });
      toast.success("User deactivated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to deactivate user");
    },
  });
}

export function useActivateUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      await activateUser({ path: { userId } });
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
      queryClient.invalidateQueries({ queryKey: usersKeys.detail(userId) });
      toast.success("User activated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to activate user");
    },
  });
}

export function useUnlockUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      await unlockUser({ path: { userId } });
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
      queryClient.invalidateQueries({ queryKey: usersKeys.detail(userId) });
      toast.success("User unlocked");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to unlock user");
    },
  });
}
