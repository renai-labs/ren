export * as Output from "./output.js"

import { Context, Effect, Layer, Schema, Terminal } from "effect"
import { Flag, GlobalFlag } from "effect/cli"
import { writeSync } from "node:fs"

const formats = ["json", "pretty"] as const

export const flag = GlobalFlag.Setting("output")({
  flag: Flag.Literals("output", formats).pipe(Flag.withDescription("Output format"), Flag.optional),
})

export interface Problem extends Schema.Schema.Type<typeof Problem> {}
export const Problem = Schema.Struct({
  path: Schema.String,
  field: Schema.optionalKey(Schema.String),
  message: Schema.String,
})

export const formatProblem = (problem: Problem) =>
  `${problem.path}: ${problem.field ? `${problem.field}: ` : ""}${problem.message}`

export class Failure extends Schema.TaggedError<Failure>()("CliError", {
  message: Schema.String,
  problems: Schema.optionalKey(Schema.Array(Problem)),
}) {
  static problems(problems: ReadonlyArray<Problem>) {
    return new Failure({ message: problems.map(formatProblem).join("\n"), problems })
  }
}

export class Service extends Context.Service<
  Service,
  {
    readonly format: (typeof formats)[number]
    readonly interactive: boolean
    readonly result: <S extends Schema.Constraint>(
      schema: S,
      value: S["Type"],
      pretty: string,
    ) => Effect.Effect<void, Schema.SchemaError, S["EncodingServices"]>
    readonly print: (text: string) => Effect.Effect<void>
    readonly diagnostic: (text: string) => Effect.Effect<void>
    readonly confirm: (organization: string) => Effect.Effect<boolean, Terminal.QuitError>
  }
>()("@ren/cli/Output") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal
    const args = process.argv.slice(2)
    const index = args.indexOf("--output")
    const chosen = index === -1 ? args.find((arg) => arg.startsWith("--output="))?.slice(9) : args.at(index + 1)
    const format = formats.find((each) => each === chosen) ?? (process.stdout.isTTY ? "pretty" : "json")
    const write = (fd: number, text: string) =>
      Effect.sync(() => {
        writeSync(fd, `${text}\n`)
      })
    return {
      format,
      interactive: process.stdin.isTTY,
      result: (schema, value, pretty) =>
        format === "pretty"
          ? write(1, pretty)
          : Schema.encodeEffect(Schema.toCodecJson(schema))(value).pipe(
              Effect.flatMap((encoded) => write(1, JSON.stringify(encoded, null, 2))),
            ),
      print: (text) => write(1, text),
      diagnostic: (text) => write(2, text),
      confirm: Effect.fn("Output.confirm")(function* (organization) {
        yield* Effect.sync(() => {
          writeSync(2, `\nType ${organization} to apply: `)
        })
        return (yield* terminal.readLine) === organization
      }),
    }
  }),
)
