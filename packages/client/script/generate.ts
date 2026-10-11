import { BunFileSystem } from "@effect/platform-bun"
import { compile, emitEffectImported, emitPromise, emitReactQuery, write } from "@ren/httpapi-codegen"
import { ClientApi, groupNames } from "@ren/protocol/client"
import { Effect } from "effect"
import { fileURLToPath } from "url"

const contract = compile(ClientApi, { groupNames })

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(contract, { mutableOutputs: true }),
        fileURLToPath(new URL("../src/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(contract, { module: "@ren/protocol/client", api: "ClientApi" }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitReactQuery(contract, { client: "../../generated/index.js" }),
        fileURLToPath(new URL("../src/react/generated", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(BunFileSystem.layer)),
)
