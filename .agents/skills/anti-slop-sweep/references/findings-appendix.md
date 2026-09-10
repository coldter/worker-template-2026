# Original findings appendix

The initial scan found 1,262 diagnostics. `require-readable-spacing` accounted for 944 (intentionally left out of scope), leaving **317 substantive anti-slop findings across 95 files**. One unrelated `unicorn/no-useless-fallback-in-spread` diagnostic was ignored.

## Rule totals

| Rule | Findings |
| --- | ---: |
| `require-safety-comment-for-type-assertion` | 118 |
| `no-runtime-typeof` | 54 |
| `no-unknown-parameters` | 41 |
| `no-unsafe-dictionary-type` | 40 |
| `no-known-value-widening` | 24 |
| `no-module-mocking` | 13 |
| `no-unknown-returns` | 12 |
| `no-chained-type-assertions` | 10 |
| `no-conditional-empty-object-spread` | 4 |
| `no-array-filter-map` | 1 |

## Findings per file

| File | Findings | Rules |
| --- | ---: | --- |
| `apps/auth/src/hooks/session-create.ts` | 2 | `no-unsafe-dictionary-type`, `no-unknown-parameters` |
| `apps/auth/src/hooks/session-update.test.ts` | 7 | `require-safety-comment-for-type-assertion` x4, `no-chained-type-assertions`, `no-known-value-widening`, `no-unknown-parameters` |
| `apps/auth/src/hooks/session-update.ts` | 1 | `no-unsafe-dictionary-type` |
| `apps/auth/src/hooks/user-create.ts` | 4 | `no-unsafe-dictionary-type` x2, `no-runtime-typeof`, `no-unknown-parameters` |
| `apps/auth/src/index.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/auth/src/instance.ts` | 6 | `require-safety-comment-for-type-assertion` x4, `no-chained-type-assertions`, `no-known-value-widening` |
| `apps/auth/src/lib/org-tables.ts` | 4 | `no-unknown-parameters`, `require-safety-comment-for-type-assertion`, `no-runtime-typeof`, `no-unsafe-dictionary-type` |
| `apps/auth/src/lib/secondary-storage.test.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-chained-type-assertions` |
| `apps/auth/src/lib/secondary-storage.ts` | 2 | `no-runtime-typeof`, `no-unknown-parameters` |
| `apps/auth/src/plugins/login-security.ts` | 6 | `no-unknown-parameters` x3, `require-safety-comment-for-type-assertion` x2, `no-runtime-typeof` |
| `apps/auth/src/plugins/organization-setup.ts` | 1 | `no-conditional-empty-object-spread` |
| `apps/auth/src/plugins/user-status.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/auth/src/server.ts` | 3 | `no-runtime-typeof` x2, `require-safety-comment-for-type-assertion` |
| `apps/server/scripts/push-debug.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-unknown-parameters` |
| `apps/server/scripts/seeds/audit-logs/seed.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-unsafe-dictionary-type` |
| `apps/server/src/__tests__/method-not-allowed.test.ts` | 6 | `no-module-mocking` x3, `require-safety-comment-for-type-assertion` x2, `no-chained-type-assertions` |
| `apps/server/src/__tests__/route-coverage.test.ts` | 7 | `require-safety-comment-for-type-assertion` x4, `no-module-mocking` x3 |
| `apps/server/src/__tests__/status-readiness.test.ts` | 4 | `require-safety-comment-for-type-assertion` x2, `no-unknown-returns`, `no-chained-type-assertions` |
| `apps/server/src/durable-objects/rate-limiter.ts` | 1 | `no-runtime-typeof` |
| `apps/server/src/lib/events.ts` | 6 | `no-known-value-widening` x3, `no-unknown-parameters` x2, `no-unsafe-dictionary-type` |
| `apps/server/src/lib/firebase-token.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/server/src/middlewares/analytics.ts` | 2 | `no-runtime-typeof` x2 |
| `apps/server/src/middlewares/error.ts` | 10 | `require-safety-comment-for-type-assertion` x3, `no-runtime-typeof` x2, `no-unsafe-dictionary-type` x2, `no-known-value-widening` x2, `no-conditional-empty-object-spread` |
| `apps/server/src/modules/audit-logs/constants.ts` | 2 | `require-safety-comment-for-type-assertion` x2 |
| `apps/server/src/modules/audit-logs/queue-dlq.test.ts` | 8 | `require-safety-comment-for-type-assertion` x4, `no-module-mocking` x2, `no-unknown-parameters`, `no-chained-type-assertions` |
| `apps/server/src/modules/audit-logs/queue-message.ts` | 1 | `no-unknown-parameters` |
| `apps/server/src/modules/audit-logs/queue.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/server/src/modules/notifications/constants.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/server/src/modules/notifications/dispatch.ts` | 1 | `no-unknown-parameters` |
| `apps/server/src/modules/notifications/types.ts` | 2 | `no-unsafe-dictionary-type` x2 |
| `apps/server/src/modules/users/constants.ts` | 2 | `require-safety-comment-for-type-assertion` x2 |
| `apps/server/src/modules/users/helpers.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-unsafe-dictionary-type` |
| `apps/server/src/modules/users/service.ts` | 3 | `require-safety-comment-for-type-assertion` x3 |
| `apps/server/src/queues/router.ts` | 1 | `no-known-value-widening` |
| `apps/server/src/utils/country-codes.ts` | 1 | `no-known-value-widening` |
| `apps/server/src/workflows/email-notification.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-chained-type-assertions` |
| `apps/server/src/workflows/onboarding.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-chained-type-assertions` |
| `apps/server/tests/helpers.ts` | 2 | `no-unknown-returns`, `require-safety-comment-for-type-assertion` |
| `apps/server/tests/setup.ts` | 1 | `no-module-mocking` |
| `apps/web/src/__tests__/on-error.test.ts` | 2 | `no-module-mocking` x2 |
| `apps/web/src/__tests__/setup.tsx` | 1 | `no-module-mocking` |
| `apps/web/src/__tests__/use-table-url-state.test.tsx` | 4 | `no-unsafe-dictionary-type` x3, `require-safety-comment-for-type-assertion` |
| `apps/web/src/hooks/use-authorization.ts` | 3 | `no-known-value-widening` x3 |
| `apps/web/src/hooks/use-server-table.ts` | 2 | `no-unsafe-dictionary-type`, `no-runtime-typeof` |
| `apps/web/src/hooks/use-table-url-state.ts` | 31 | `no-runtime-typeof` x12, `no-unsafe-dictionary-type` x7, `no-unknown-parameters` x6, `no-unknown-returns` x4, `require-safety-comment-for-type-assertion` x2 |
| `apps/web/src/lib/brand.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/lib/report-error.ts` | 2 | `no-unsafe-dictionary-type`, `no-unknown-parameters` |
| `apps/web/src/lib/show-submitted-data.tsx` | 1 | `no-unknown-parameters` |
| `apps/web/src/modules/audit-logs/detail/audit-log-detail-sheet.tsx` | 14 | `no-runtime-typeof` x5, `require-safety-comment-for-type-assertion` x4, `no-unsafe-dictionary-type` x4, `no-known-value-widening` |
| `apps/web/src/modules/audit-logs/event-icon.tsx` | 1 | `no-known-value-widening` |
| `apps/web/src/modules/audit-logs/event-utils.ts` | 4 | `no-known-value-widening` x3, `no-unsafe-dictionary-type` |
| `apps/web/src/modules/audit-logs/table/columns.tsx` | 1 | `no-known-value-widening` |
| `apps/web/src/modules/audit-logs/table/filters.tsx` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/modules/common/app-error.tsx` | 2 | `no-unknown-parameters`, `no-runtime-typeof` |
| `apps/web/src/modules/common/command-menu.tsx` | 1 | `no-unknown-returns` |
| `apps/web/src/modules/data-table/faceted-filter.tsx` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/modules/data-table/pagination.tsx` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/modules/data-table/toolbar.tsx` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/modules/layout/nav-group.tsx` | 1 | `no-array-filter-map` |
| `apps/web/src/modules/settings/appearance/appearance-form.tsx` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/modules/ui/form.tsx` | 2 | `require-safety-comment-for-type-assertion` x2 |
| `apps/web/src/modules/ui/sidebar.tsx` | 5 | `require-safety-comment-for-type-assertion` x3, `no-runtime-typeof` x2 |
| `apps/web/src/modules/ui/sonner.tsx` | 2 | `require-safety-comment-for-type-assertion` x2 |
| `apps/web/src/modules/ui/spinner.tsx` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/modules/users/table/users-table.stories.tsx` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/src/query/on-error.ts` | 15 | `no-unknown-parameters` x6, `no-runtime-typeof` x4, `require-safety-comment-for-type-assertion` x2, `no-unsafe-dictionary-type` x2, `no-known-value-widening` |
| `apps/web/src/store/alert.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `apps/web/vite/openapi-watch-mode.ts` | 4 | `no-runtime-typeof` x3, `no-unknown-parameters` |
| `packages/authorization/src/__tests__/conditions.test.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `packages/authorization/src/__tests__/evaluator.test.ts` | 7 | `require-safety-comment-for-type-assertion` x6, `no-unknown-parameters` |
| `packages/authorization/src/__tests__/hono.test.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `packages/authorization/src/__tests__/resource.test.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `packages/authorization/src/conditions.ts` | 2 | `require-safety-comment-for-type-assertion`, `no-runtime-typeof` |
| `packages/authorization/src/evaluator.ts` | 4 | `no-unknown-parameters` x3, `require-safety-comment-for-type-assertion` |
| `packages/authorization/src/hono.ts` | 13 | `require-safety-comment-for-type-assertion` x7, `no-runtime-typeof` x2, `no-unsafe-dictionary-type` x2, `no-unknown-parameters`, `no-chained-type-assertions` |
| `packages/authorization/src/registry.ts` | 4 | `require-safety-comment-for-type-assertion` x3, `no-chained-type-assertions` |
| `packages/authorization/src/resource.ts` | 2 | `require-safety-comment-for-type-assertion` x2 |
| `packages/authorization/src/schema.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `packages/authorization/src/types.ts` | 2 | `no-unsafe-dictionary-type` x2 |
| `packages/authorization/src/validation.ts` | 2 | `no-unknown-parameters`, `no-runtime-typeof` |
| `packages/db/src/client.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `packages/db/src/ids.ts` | 5 | `require-safety-comment-for-type-assertion` x5 |
| `packages/db/src/schema/notifications.ts` | 1 | `no-unsafe-dictionary-type` |
| `packages/email/src/__tests__/send.test.tsx` | 2 | `no-module-mocking`, `no-unknown-parameters` |
| `packages/shared/src/audit.ts` | 1 | `no-unsafe-dictionary-type` |
| `packages/shared/src/authorization-schema.ts` | 2 | `require-safety-comment-for-type-assertion` x2 |
| `packages/shared/src/kv-cache.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `packages/shared/src/logger-drizzle.ts` | 4 | `no-runtime-typeof` x4 |
| `packages/shared/src/logger.ts` | 5 | `no-unsafe-dictionary-type`, `no-unknown-parameters`, `no-unknown-returns`, `no-known-value-widening`, `no-conditional-empty-object-spread` |
| `packages/shared/src/pagination.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-unknown-returns` |
| `packages/shared/src/principal-builder.ts` | 3 | `require-safety-comment-for-type-assertion` x2, `no-conditional-empty-object-spread` |
| `packages/shared/src/redaction.ts` | 19 | `no-runtime-typeof` x7, `no-unknown-parameters` x3, `no-unknown-returns` x3, `no-known-value-widening` x3, `no-unsafe-dictionary-type` x2, `require-safety-comment-for-type-assertion` |
| `packages/shared/src/roles.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `packages/shared/src/users.ts` | 1 | `require-safety-comment-for-type-assertion` |
| `scripts/init-template.ts` | 2 | `no-known-value-widening`, `require-safety-comment-for-type-assertion` |
