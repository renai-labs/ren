export * as Health from "./health.js"

import { Health } from "@renai-labs/sdk/effect"
import { Effect } from "effect"
import { Connection } from "../services/connection.js"
import { Output } from "../services/output.js"

export const run = Effect.gen(function* () {
  const connection = yield* Connection.Service
  const output = yield* Output.Service
  const client = yield* connection.connect()
  const health = yield* client.health.get()
  yield* output.result(Health.Info, health, `${health.status} (${health.version})`)
})
