# Data Fetching

All server state is managed through TanStack Query v5. Follow these conventions to keep data fetching consistent, performant, and maintainable.

## Query Key Factories

Every module that fetches data must define a key factory object in its `query.ts` file. Never use inline string arrays as query keys.

```typescript
export const exampleKeys = {
  all: ["example"] as const,
  lists: () => [...exampleKeys.all, "list"] as const,
  list: (params: ListParams) => [...exampleKeys.lists(), params] as const,
  details: () => [...exampleKeys.all, "detail"] as const,
  detail: (id: string) => [...exampleKeys.details(), id] as const,
};
```

Hierarchical keys enable targeted invalidation at any level (e.g. `exampleKeys.lists()` invalidates all list variants without touching detail caches).

## Query Functions

- Put API calls inside feature query/mutation hooks, not directly inside components.
- Always destructure `signal` from the query context and pass it to the SDK call for automatic cancellation on unmount or navigation:

```typescript
export function useExampleQuery(id: string) {
  return useQuery({
    queryKey: exampleKeys.detail(id),
    queryFn: async ({ signal }) => {
      const response = await getExample({ path: { id }, signal });
      return response.data;
    },
  });
}
```

## Query Options Factories

Use `queryOptions()` when a query config needs to be shared across hooks and route loaders:

```typescript
export const exampleQueryOptions = (id: string) =>
  queryOptions({
    queryKey: exampleKeys.detail(id),
    queryFn: async ({ signal }) => {
      const response = await getExample({ path: { id }, signal });
      return response.data;
    },
  });
```

## Mutations

- Use `useMutation` with explicit `onSuccess` / `onError` callbacks.
- Always invalidate affected queries on success using the key factory:

```typescript
onSuccess: (_, { id }) => {
  queryClient.invalidateQueries({ queryKey: exampleKeys.lists() });
  queryClient.invalidateQueries({ queryKey: exampleKeys.detail(id) });
  toast.success("Updated successfully");
},
onError: (error) => {
  toast.error(error.message || "Failed to update");
},
```

- The global `QueryCache` handles error toasts for queries (401, 403, 5xx). Mutations handle their own error toasts via per-hook `onError` callbacks. Do not add `onError` to the `MutationCache` to avoid double toasts.
- Use optimistic updates only when rollback behavior is clearly defined.

## Caching Strategy

| Data type | staleTime | Notes |
|-----------|-----------|-------|
| Global default | 30s | Set in QueryClient defaults |
| Session / auth | 5 min | Refetches on window focus |
| Authorization capabilities | 5 min | Low volatility reference data |
| Real-time data | 0 | Override per-query when needed |

- `gcTime` is set to 24 hours globally. Inactive queries stay in cache for fast revisits.
- `refetchOnWindowFocus` is disabled globally; enable per-query where freshness matters (e.g. session).
- `retry` is disabled globally. The global error handler provides immediate feedback.

## Router Integration

- The router uses `defaultPreload: "intent"` to prefetch route data on hover/focus.
- `defaultPreloadStaleTime: 0` defers all cache decisions to TanStack Query (single source of truth).
- Use `ensureQueryData` in `beforeLoad` for route-level data requirements. Use `queryOptions()` factories to share config between loaders and components.

## State Flags

TanStack Query v5 state flags:

| Flag | Meaning | Use for |
|------|---------|---------|
| `isPending` | No cached data | Conditional rendering when query has `enabled` conditions |
| `isFetching` | Actively fetching | Background refresh indicators |
| `isLoading` | `isPending && isFetching` | Loading spinners on initial load |
| `isError` | Query failed | Error states |

For mutations, use `isPending` (not `isLoading`) to disable buttons during submission.

## Error Handling

- Query errors are handled globally via `QueryCache.onError` (session expiry, maintenance, server errors).
- Mutation errors are handled per-hook via `onError` callbacks with specific user-facing messages.
- Components use `isError` from query results to render error states when needed.
