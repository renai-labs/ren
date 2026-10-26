# @ren/server

- Handlers decode, call a core service and map errors. They never import `@ren/db`.
- Primitive handlers wire each endpoint with `Primitive.<operation>(service.<operation>)` inside `HttpApiBuilder.group`, and `Primitive.action(service.<action>)` for actions. An action declared with `{ invalid: true }` uses `Primitive.update(service.<action>)`, which also maps `Primitive.Invalid`. The helpers build the `Actor` and map core errors to protocol errors.
- Register each group's handler layer and its core service layer in `src/routes.ts`.
- After a change to Better Auth options or plugins in `src/auth`, run `bun run generate` from the repo root, then `bun run db generate` in `packages/db` for the migration.
- API tests can use `testEffect(ApiFixture.layer)` and `ApiFixture.owner()` from `@ren/server/testing/api`. The fixture owns its handler and isolated database. Its owner has a real signed database session and a `request(method, path, body?)` Effect. Use the real sign-up and sign-in routes when those flows are the behavior under test.
