import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Array, Effect, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import { Runtime } from "../../src/runtime.js"
import { Output } from "../../src/services/output.js"

export const items = Array.makeBy(100_000, (index) => `item ${index}`)

const command = Command.make("large", { fail: Flag.Boolean("fail").pipe(Flag.withDefault(false)) }, (input) =>
  Effect.gen(function* () {
    const output = yield* Output.Service
    if (input.fail) return yield* new Output.Failure({ message: items.join(" ") })
    yield* output.result(Schema.Array(Schema.String), items, items.join("\n"))
  }),
)

if (import.meta.main)
  Runtime.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Output.layer),
    Effect.provide(BunServices.layer),
    BunRuntime.runMain({ disableErrorReporting: true }),
  )
