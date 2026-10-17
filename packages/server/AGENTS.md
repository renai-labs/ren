# @ren/server

- Handlers decode, call a core service and map errors. They never import `@ren/db`.
- Primitive handlers wire each endpoint with `Primitive.<operation>(service.<operation>)` inside `HttpApiBuilder.group`, and `Primitive.action(service.<action>)` for actions. The helpers build the `Actor` and map core errors to protocol errors.
- Register each group's handler layer and its core service layer in `src/routes.ts`.
- After a change to Better Auth options or plugins in `src/auth`, run `bun run generate` from the repo root, then `bun run db generate` in `packages/db` for the migration.
