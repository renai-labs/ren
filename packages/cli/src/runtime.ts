export * as Runtime from "./runtime.js"

import { Cause, Console, Effect, Exit } from "effect"
import { CliConfig, CliError, Command, GlobalFlag } from "effect/cli"
import { format } from "node:util"
import { Output } from "./services/output.js"

export const run = <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  options: { readonly version: string },
) =>
  Effect.gen(function* () {
    yield* Effect.yieldNow
    const output = yield* Output.Service
    const console = yield* Console.Console
    const helpOutput: Array<string> = []
    const exit = yield* Command.run(command, { ...options, renderErrors: false }).pipe(
      Effect.provideService(Console.Console, {
        // oxlint-disable-next-line typescript/no-misused-spread -- Effect Console is a plain service value, not a class instance.
        ...console,
        log: (...args: ReadonlyArray<unknown>) => {
          helpOutput.push(format(...args))
        },
      }),
      Effect.provide(CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] })),
      Effect.scoped,
      Effect.exit,
    )
    if (helpOutput.length > 0) {
      if (Exit.isSuccess(exit)) yield* output.result(helpOutput.join("\n"))
      else yield* output.diagnostic(helpOutput.join("\n"))
    }
    if (Exit.isSuccess(exit)) return
    if (!Cause.hasInterruptsOnly(exit.cause)) {
      const error = Cause.squash(exit.cause)
      const message =
        CliError.isCliError(error) && error._tag === "ShowHelp"
          ? error.errors.map((issue) => issue.message).join("\n")
          : String(error instanceof Error ? error.message : error)
      if (message) yield* output.diagnostic(message)
    }
    return yield* Effect.failCause(exit.cause)
  })
