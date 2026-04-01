# Response Shapes

Use module-specific schemas in `apps/server/src/modules/*/schema.ts` as the source of truth. The shapes below are common patterns, not strict global contracts.

## Paginated Response

```typescript
{
  data: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    pageCount: number;
    hasNext: boolean;
    hasPrev: boolean;
    nextPage: number | null;
    prevPage: number | null;
  };
}
```

## Single Entity Response

```typescript
{ user: UserSchema }
```

Other endpoints use similarly scoped keys such as `{ roles: Role[] }`, `{ profile: ... }`, `{ notification: ... }`, `{ preferences: ... }`.

## Action Response

```typescript
{ success: true }
```
