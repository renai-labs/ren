export * as Output from "./output.js"

import { Context, Effect, Layer, Terminal } from "effect"
import { writeSync } from "node:fs"

export class Service extends Context.Service<
  Service,
  {
    readonly interactive: boolean
    readonly result: (text: string) => Effect.Effect<void>
    readonly diagnostic: (text: string) => Effect.Effect<void>
    readonly confirm: (organization: string) => Effect.Effect<boolean, Terminal.QuitError>
  }
>()("@ren/cli/Output") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal
    return {
      interactive: process.stdin.isTTY,
      result: (text) =>
        Effect.sync(() => {
          writeSync(1, `${text}\n`)
        }),
      diagnostic: (text) =>
        Effect.sync(() => {
          writeSync(2, `${text}\n`)
        }),
      confirm: Effect.fn("Output.confirm")(function* (organization) {
        yield* Effect.sync(() => {
          writeSync(2, `\nType ${organization} to apply: `)
        })
        return (yield* terminal.readLine) === organization
      }),
    }
  }),
)
