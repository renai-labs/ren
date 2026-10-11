# @ren/db

Postgres access: Drizzle tables, migrations, connection layers and isolated test databases.

## What belongs here

- `src/**/*.sql.ts`: Drizzle tables.
- `src/postgres.ts`: `PgClient` layer configured from `DATABASE_URL`.
- `src/database.ts`: `Database.Service`, the Effect-native Drizzle instance.
- `src/auth.sql.ts`: Better Auth tables, generated from `@ren/core`'s auth config (`bun run generate` in `packages/core`).
- `src/testing.ts`: `Testing.layer`, which creates and drops an isolated database for tests.
- `migration/`: generated SQL migrations.

## What does not

- Business rules (`@ren/core`).
- HTTP concerns (`@ren/server`).

## Dependencies

`@ren/schema`, `@ren/util`, `@effect/sql-pg`, `drizzle-orm`, `effect`.

## Commands

```sh
bun run test   # needs `docker compose up -d`
bun typecheck
bun run db generate   # drizzle-kit
```
