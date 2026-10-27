export * as Runtime from "./runtime.js"

import { ApiError } from "@renai-labs/sdk/effect"
import { Cause, Console, Data, Effect, Exit, Predicate, Runtime } from "effect"
import { CliConfig, CliError, Command, GlobalFlag } from "effect/cli"
import { HttpClientError } from "effect/http"
import { format } from "node:util"
import { Output } from "./services/output.js"

class Exited extends Data.Error<{ readonly [Runtime.errorExitCode]: number }> {}

const isApiError = (error: unknown): error is InstanceType<(typeof ApiError)[keyof typeof ApiError]> =>
  Object.values(ApiError).some((type) => error instanceof type)

export const describe = (
  error: unknown,
): { readonly type: string; readonly message: string; readonly [field: string]: unknown } => {
  if (CliError.isCliError(error) && error._tag === "ShowHelp")
    return {
      type: "UsageError",
      message:
        error.errors.map((issue) => issue.message).join("\n") ||
        `Choose a subcommand of ${error.commandPath.join(" ")}.`,
    }
  if (CliError.isCliError(error) && error._tag !== "UserError") return { type: "UsageError", message: error.message }
  if (Predicate.isTagged(error, "UnauthorizedError"))
    return { type: "UnauthorizedError", message: "Not logged in. Run ren2 login." }
  if (isApiError(error) || error instanceof Output.Failure)
    return {
      type: error._tag,
      message: error.message,
      ...Object.fromEntries(Object.entries(error).filter((entry) => entry.at(0) !== "_tag")),
    }
  return { type: "CliError", message: message(error) }
}

const message = (error: unknown): string => {
  if (Predicate.isTagged(error, "ClientError") && Predicate.hasProperty(error, "cause")) return message(error.cause)
  if (HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError")
    return `Could not reach ${new URL(error.request.url).origin}.`
  return error instanceof Error ? error.message : format(error)
}

export const run = <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  options: { readonly version: string },
) =>
  Effect.gen(function* () {
    yield* Effect.yieldNow
    const output = yield* Output.Service
    const console = yield* Console.Console
    const helpOutput: Array<string> = []
    const exit = yield* Command.run(command.pipe(Command.withGlobalFlags([Output.flag])), {
      ...options,
      renderErrors: false,
    }).pipe(
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
    if (Exit.isSuccess(exit)) {
      if (helpOutput.length > 0) yield* output.print(helpOutput.join("\n"))
      return
    }
    if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
    const failure = describe(Cause.squash(exit.cause))
    const usage = failure.type === "UsageError"
    if (output.format === "json") yield* output.diagnostic(JSON.stringify({ error: failure }))
    else yield* output.diagnostic([...(usage ? helpOutput : []), failure.message].join("\n"))
    return yield* usage ? Effect.fail(new Exited({ [Runtime.errorExitCode]: 2 })) : Effect.failCause(exit.cause)
  })
