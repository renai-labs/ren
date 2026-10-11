# @ren/protocol

- One `HttpApiGroup` per domain in `src/groups/<domain>.ts`, named `server.<domain>`, then added to `src/api.ts` and to `groupNames` in `src/client.ts`.
- Endpoint names are `<domain>.<action>` (`pod.list`, `pod.get`), and match the OpenAPI `identifier` annotation.
- Paths start with `/api/`.
- Reuse schemas from `@ren/schema` for request and response bodies. Define request-only shapes here.
- Declare every error an endpoint can return. Shared errors live in `src/errors.ts` with an `httpApiStatus`.
- Annotate endpoints with `OpenApi.annotations({ identifier, summary, description })`.
- After any change, run `bun run generate` from the repo root and commit `openapi.json` plus the regenerated clients.
- Primitive groups use `Primitive.group(definition, exposure, [Primitive.list(definition), …])`, one constructor per declared operation and `Primitive.action(definition, name)` per action. The constructors add routes, errors, annotations and middleware.
- Hand-written groups are exceptions listed with a reason in `script/contract.ts`. Better Auth owns `/api/auth/*`, which is outside this API.
- Every group carries an `Exposure` annotation. `bun run generate` fails when the contract check in `script/contract.ts` finds a violation.
