# @ren/protocol

- One `HttpApiGroup` per domain in `src/groups/<domain>.ts`, named `<domain>`, then added to `src/api.ts`. The group name is also the client group name.
- Endpoint names are `<domain>.<action>` (`pod.list`, `pod.get`), and match the OpenAPI `identifier` annotation.
- Paths start with `/`.
- Reuse schemas from `@ren/schema` for request and response bodies. Define request-only shapes here.
- Declare every error an endpoint can return. Shared errors live in `src/errors.ts` with an `httpApiStatus`.
- Annotate endpoints with `OpenApi.annotations({ identifier, summary, description })`.
- After any change, run `bun run generate` from the repo root and commit `openapi.json` plus the regenerated clients.
- Primitive groups use `Primitive.group(definition, exposure, [Primitive.list(definition), …])`, one constructor per declared operation and `Primitive.action(definition, name)` per action. The constructors add routes, errors, annotations and middleware.
- Hand-written groups are exceptions listed with a reason in `script/contract.ts`. Better Auth owns `/auth/*`, which is outside this API.
- Every group carries an `Exposure` annotation.
- `bun run generate` fails when `script/contract.ts` finds a group that is neither a primitive nor a listed exception, or a primitive group that does not serve exactly its declared operations.
