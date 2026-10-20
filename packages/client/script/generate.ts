import { BunFileSystem } from "@effect/platform-bun"
import { Compile, EmitEffectImported, EmitPromise, EmitReactQuery, Write } from "@ren/httpapi-codegen"
import { ChatApi } from "@ren/protocol/chat"
import { ClientApi } from "@ren/protocol/client"
import { Effect } from "effect"
import { fileURLToPath } from "url"

const contract = Compile.compile(ClientApi)
const chat = Compile.compile(ChatApi)

await Effect.runPromise(
  Effect.all(
    [
      Write.write(
        EmitPromise.emitPromise(contract, { mutableOutputs: true }),
        fileURLToPath(new URL("../src/generated", import.meta.url)),
      ),
      Write.write(
        EmitEffectImported.emitEffectImported(contract, { module: "@ren/protocol/client", api: "ClientApi" }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      Write.write(
        EmitReactQuery.emitReactQuery(contract, { client: "../../generated/index.js" }),
        fileURLToPath(new URL("../src/react/generated", import.meta.url)),
      ),
      Write.write(
        EmitPromise.emitPromise(chat, { mutableOutputs: true }),
        fileURLToPath(new URL("../src/chat/generated", import.meta.url)),
      ),
      Write.write(
        EmitEffectImported.emitEffectImported(chat, { module: "@ren/protocol/chat", api: "ChatApi" }),
        fileURLToPath(new URL("../src/chat/effect/generated", import.meta.url)),
      ),
    ],
    { concurrency: 5, discard: true },
  ).pipe(Effect.provide(BunFileSystem.layer)),
)
