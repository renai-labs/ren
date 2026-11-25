export * as Whoami from "./whoami.js"

import { Auth } from "@ren/schema/auth"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { RenAuth } from "../src/auth.js"
import { RenApi } from "../src/ren.js"

const me = await Effect.gen(function* () {
  const ren = yield* RenApi.Service
  const client = yield* ren.client
  return yield* client.me.get()
}).pipe(
  Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Auth.Me))),
  Effect.provide(RenApi.layer.pipe(Layer.provideMerge(RenAuth.layer({})), Layer.provide(FetchHttpClient.layer))),
  Effect.runPromiseExit,
)
if (Exit.isSuccess(me)) process.stdout.write(`${me.value}\n`)
else {
  process.stderr.write(`${Cause.pretty(me.cause)}\n`)
  process.exitCode = 1
}
