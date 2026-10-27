import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { format } from "node:util"
import { BunServices } from "@effect/platform-bun"
import { Console, Effect, Option } from "effect"
import { Command } from "effect/cli"
import { Compile, EmitCli } from "../src/index.js"
import { Api } from "./lib/widget-api.js"

const contract = Compile.compile(Api)

const groups: ReadonlyArray<EmitCli.Group> = [{ path: ["widget"], description: "Manage widgets", alias: "widgets" }]

const commands: ReadonlyArray<EmitCli.Command> = [
  { operation: "widget.list", path: ["widget", "list"], arguments: ["ownerId"], names: { ownerId: "owner" } },
  { operation: "widget.get", path: ["widget", "get"], names: { idOrSlug: "widget" } },
  {
    operation: "widget.update",
    path: ["widget", "update"],
    names: { id: "widget" },
    lookups: { id: { operation: "widget.get", input: "idOrSlug", output: "id" } },
  },
]

const runtime = `import { Effect } from "effect"
export const calls = []
const client = new Proxy({}, { get: (_, group) => new Proxy({}, { get: (_, method) => (input) => Effect.sync(() => { calls.push({ call: group + "." + method, input }); return { id: "w_1" } }) }) })
export const Operation = {
  run: (endpoint, input, call) => Effect.gen(function* () {
    calls.push({ endpoint: endpoint.identifier, input: { ...input, lookups: Object.keys(input.lookups ?? {}) } })
    for (const lookup of Object.values(input.lookups ?? {})) yield* lookup(client, "blue")
    yield* call(client, { params: { id: "w_1" }, query: { ownerId: "o_1" }, payload: { name: "Blue" } })
  }),
}
`

async function emitted() {
  const directory = await mkdtemp(join(import.meta.dir, ".emitted-"))
  const output = EmitCli.emitCli(contract, {
    module: join(import.meta.dir, "lib/widget-api.ts"),
    api: "Api",
    runtime: join(directory, "runtime.ts"),
    groups,
    commands,
  })
  await Bun.write(join(directory, "runtime.ts"), runtime)
  // oxlint-disable-next-line ren/no-comments -- Finish each write before the emitted modules are imported.
  await Array.fromAsync(output.files, (item) => Bun.write(join(directory, item.path), item.content))
  // ast-grep-ignore: no-dynamic-import-path, -- The module is emitted into a temporary directory at runtime, so its path cannot be literal.
  const tree = await import(join(directory, "commands.ts"))
  // ast-grep-ignore: no-dynamic-import-path, -- The recording runtime is written into the same temporary directory.
  const recorded = await import(join(directory, "runtime.ts"))
  const printed: Array<string> = []
  const subcommands: ReadonlyArray<Command.Command<string, unknown, unknown, unknown>> = tree.commands
  const root = Command.make("cli").pipe(Command.withSubcommands(subcommands))
  const run = (args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const console = yield* Console.Console
      yield* Command.runWith(root, { version: "0.0.0" })(args).pipe(
        Effect.provideService(Console.Console, {
          // oxlint-disable-next-line typescript/no-misused-spread -- Effect Console is a plain service value, not a class instance.
          ...console,
          log: (...values: ReadonlyArray<unknown>) => {
            printed.push(format(...values))
          },
        }),
      )
    }).pipe(Effect.provide(BunServices.layer), Effect.runPromise)
  return {
    run,
    printed,
    calls: recorded.calls,
    [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }),
  }
}

describe("EmitCli.emitCli", () => {
  test("names commands from the table, with the group's alias, positional resources and typed flags that the wire may omit", async () => {
    await using cli = await emitted()
    await cli.run(["widgets", "list", "o_1", "--status", "active", "--page", "2"])
    expect(cli.calls).toEqual([
      {
        endpoint: "widget.list",
        input: {
          query: { ownerId: "o_1", status: Option.some("active"), page: Option.some(2), pageSize: Option.none() },
          labels: { ownerId: "<owner>", status: "--status", page: "--page", pageSize: "--page-size" },
          lookups: [],
        },
      },
      { call: "widget.list", input: { ownerId: "o_1" } },
    ])
  })

  test("turns payload scalars and lists into flags, leaves nested fields to --input and resolves names", async () => {
    await using cli = await emitted()
    await cli.run(["widget", "update", "blue", "--name", "Blue", "--tags", "a", "--input", '{"settings":{}}'])
    expect(cli.calls).toEqual([
      {
        endpoint: "widget.update",
        input: {
          params: { id: "blue" },
          payload: { name: Option.some("Blue"), tags: ["a"] },
          input: Option.some('{"settings":{}}'),
          labels: { id: "<widget>", name: "--name", tags: "--tags" },
          lookups: ["id"],
        },
      },
      { call: "widget.get", input: { idOrSlug: "blue" } },
      { call: "widget.update", input: { id: "w_1", name: "Blue" } },
    ])
    await cli.run(["widget", "update", "--help"])
    const help = cli.printed.join("\n")
    expect(help).toContain("Update widget")
    expect(help).toContain("Widget name")
    expect(help).toContain("--input")
    expect(help).not.toContain("--settings")
  })

  test("rejects a repeated path, a command that is also a group, a group without a description and colliding names", () => {
    const emit = (options: Partial<EmitCli.Options>) => () =>
      EmitCli.emitCli(contract, { module: "api", api: "Api", runtime: "runtime", groups, commands, ...options })
    expect(emit({ commands: [...commands, { operation: "widget.get", path: ["widget", "list"] }] })).toThrow(
      "Command path is used twice: widget list",
    )
    expect(emit({ commands: [...commands, { operation: "widget.get", path: ["widget", "list", "one"] }] })).toThrow(
      "Command is also a group: widget list",
    )
    expect(emit({ groups: [] })).toThrow("Group needs a description: widget")
    expect(
      emit({
        commands: [{ operation: "widget.update", path: ["widget", "update"], names: { id: "widget", name: "widget" } }],
      }),
    ).toThrow("Two inputs of widget.update are both named widget")
    expect(emit({ commands: [{ operation: "widget.remove", path: ["widget", "remove"] }] })).toThrow(
      "Unknown operation: widget.remove",
    )
  })
})
