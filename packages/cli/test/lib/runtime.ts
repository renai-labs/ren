import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { Argument, Command } from "effect/cli"
import { Runtime } from "../../src/runtime.js"
import { Output } from "../../src/services/output.js"

const command = Command.make("wait", { released: Argument.String("released") }, (input) =>
  Effect.gen(function* () {
    const output = yield* Output.Service
    yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(input.released, "released")))
    yield* output.result("ready")
    yield* Effect.never
  }),
)

Runtime.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(Output.layer),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
