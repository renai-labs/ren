# @ren/core

- One module per domain. Each exports `Interface`, `Service` (`Context.Service`, keyed `@ren/core/<Name>`) and `layer`. A service with one implementation per provider exports `layer<Provider>` instead (`BrainHost.layerCelld`).
- Name service methods with `Effect.fn("<Name>.<method>")`.
- Re-export schema values from `@ren/schema` instead of redefining them.
- Core never imports `@ren/protocol` or `@ren/server`, and never knows about Ren's own HTTP API. It calls outside services through `HttpClient` (`Mailer`), and session hosts through `@ren/brain-api` (`BrainHost`).
- Tests use `testEffect(layer)` from `test/lib/effect.ts`. Use `it.live` for real time, the filesystem, child processes or the database.
- Tests run through `script/test.ts` at the repo root, with a temporary HOME and without credential env vars.
- A primitive service's `Interface` extends `Primitive.Interface<typeof <Name>.definition>`. Methods take the caller's `Actor.Info` first.
- Primitive methods fail only with `Primitive.NotFound`, `Primitive.Forbidden` or `Primitive.Conflict`. A record the actor cannot see is `NotFound`.
