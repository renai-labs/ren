export * as Runtime from "./runtime.js"

import { Cause, Console, Effect, Exit, Predicate } from "effect"
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
    const error = Cause.hasInterruptsOnly(exit.cause) ? undefined : Cause.squash(exit.cause)
    if (Predicate.isTagged(error, "UnauthorizedError")) yield* output.diagnostic("Not logged in. Run ren2 login.")
    else if (CliError.isCliError(error) && error._tag === "ShowHelp") {
      if (error.errors.length > 0) yield* output.diagnostic(error.errors.map((issue) => issue.message).join("\n"))
    } else if (error) yield* output.diagnostic(error instanceof Error ? error.message : format(error))
    return yield* Effect.failCause(exit.cause)
  })
