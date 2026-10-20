# @ren/db

Postgres access: Drizzle tables, migrations, connection layers and isolated test databases.

## What belongs here

- `src/**/*.sql.ts`: Drizzle tables.
- `src/postgres.ts`: `PgClient` layer configured from `DATABASE_URL`.
- `src/database.ts`: `Database.Service`, the Effect-native Drizzle instance with relations, and `Database.Schema`, the tables.
- `src/auth.sql.ts`: Better Auth tables, generated from `@ren/server`'s auth config (`bun run generate` in `packages/server`).
- `src/auth-database.ts`: `AuthDatabase.Service`, a Promise-based Drizzle instance (`bun-sql`) used only by Better Auth.
- `test/lib/testing.ts` (`@ren/db/testing`): `Testing.layer`, which creates an isolated database, applies migrations, and drops it afterwards.
- `migration/`: generated SQL migrations.

## What does not

- Business rules (`@ren/core`).
- HTTP concerns (`@ren/server`).

## Dependencies

`@ren/schema`, `@effect/sql-pg`, `drizzle-orm`, `effect`.

## Commands

```sh
bun run test   # needs `docker compose up -d`
bun typecheck
bun run db generate   # drizzle-kit
bun run db migrate    # apply migrations to DATABASE_URL
```
