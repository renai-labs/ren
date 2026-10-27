export * as Health from "./health.js"

import { Effect } from "effect"
import { Connection } from "../services/connection.js"
import { Output } from "../services/output.js"

export const run = Effect.gen(function* () {
  const connection = yield* Connection.Service
  const output = yield* Output.Service
  const client = yield* connection.client
  yield* output.result(JSON.stringify(yield* client.health.get()))
})
