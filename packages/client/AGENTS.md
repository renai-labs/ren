# @ren/client

- Never edit `src/generated/` or `src/effect/generated/`. Change `@ren/protocol` and run `bun run generate` from the repo root.
- The root entrypoint must stay free of `effect`, `@ren/schema` and `@ren/protocol` so it stays small in browsers.
- `@ren/client/effect` may use `effect`, `@ren/schema` and `@ren/protocol`, never `core`, `db` or `server`.
- `test/import-boundaries.test.ts` enforces both rules. Add new entrypoints to it.
- Generator behavior lives in `@ren/httpapi-codegen`. Fix generated-output problems there, with a test.
