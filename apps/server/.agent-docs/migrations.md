# Database Migrations

## Golden Rule

**Never create migration files or directories by hand.** Always use Drizzle Kit commands to generate them.

## Generated Migrations (Schema Changes)

When you add or change tables/columns/indexes in `packages/db/src/schema/`:

```bash
bun run db:generate   # generates migration in packages/db/src/migrations/
```

This produces a timestamped directory with `migration.sql` + `snapshot.json`. Both files are required — the snapshot tracks Drizzle's internal schema state. Do not edit generated files.

## Custom Migrations

Use a custom migration **only** for SQL that Drizzle cannot generate from the schema:
- PostgreSQL extensions (`CREATE EXTENSION`)
- PostGIS geometry columns (`ALTER TABLE ... ADD COLUMN geom geometry(...)`)
- Operator-class indexes (e.g., GiST spatial indexes)
- Data backfills (`UPDATE` statements)

### Custom SQL Migrations (Current Repo Rule)

This repository currently tracks generated Drizzle migrations in `packages/db/src/migrations/`.

If you need custom SQL that schema generation cannot express, prefer the smallest safe approach:

- Generate a migration with Drizzle first whenever possible.
- Add custom SQL within the generated migration file only when needed.
- Keep timestamp order intact and do not rename migration directories.

## Common Mistakes

- **Creating migration directories by hand.** Always use `drizzle-kit generate` (schema) or `drizzle-kit generate --custom` (custom SQL). Hand-created directories lack a valid `snapshot.json`, which breaks Drizzle's schema state tracking and causes incorrect diffs on future generates.
- **Writing migration SQL by hand instead of generating.** The generated SQL is the source of truth — it matches the Drizzle schema exactly (enum values, column types, index names, constraint names). Hand-written SQL drifts.
- **Renaming migration directories to fix ordering.** This breaks the `snapshot.json` chain (`id`/`prevIds`). Instead, delete and regenerate in the correct order.
- **Putting extensions in the schema file.** `CREATE EXTENSION` is not supported by Drizzle schema declarations. Use a custom migration that runs before the generated one.
