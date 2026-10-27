export * as InfraCommand from "./command.js"

import { Infra } from "@ren/schema/infra"
import { Effect, Option, Schema } from "effect"
import type { Command } from "effect/cli"
import { resolve } from "node:path"
import type { Commands } from "../commands.js"
import { Connection } from "../services/connection.js"
import { Output } from "../services/output.js"
import { InfraFolder } from "./folder.js"

const marks = { archive: "-", update: "~", create: "+" } as const

const line = (change: Infra.Change) =>
  [
    `${marks[change.action]} ${change.action} ${change.kind} ${change.path}`,
    change.from ? ` (from ${change.from})` : "",
    change.fields.length > 0 ? `: ${change.fields.join(", ")}` : "",
  ].join("")

export const render = (plan: Pick<Infra.Plan, "changes">) => [
  ...plan.changes.filter((change) => change.action === "archive").map(line),
  ...plan.changes.filter((change) => change.action !== "archive").map(line),
]

export type Gate =
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "refuse"; readonly message: string }
  | { readonly kind: "confirm" }
  | { readonly kind: "apply" }

export const gate = (
  plan: Infra.Plan,
  options: { readonly interactive: boolean; readonly digest?: string; readonly allowArchive: boolean },
): Gate => {
  if (plan.changes.length === 0) return { kind: "done", message: "Nothing to apply." }
  if (options.interactive) return { kind: "confirm" }
  if (!options.digest)
    return { kind: "refuse", message: "Without a terminal, apply needs --plan <digest> from ren2 infra plan." }
  if (options.digest !== plan.digest)
    return {
      kind: "refuse",
      message: `The plan has changed since digest ${options.digest}. Run ren2 infra plan again.`,
    }
  const archives = plan.changes.filter((change) => change.action === "archive").length
  if (archives > 0 && !options.allowArchive)
    return {
      kind: "refuse",
      message: `The plan archives ${archives} ${archives === 1 ? "row" : "rows"}. Pass --allow-archive to apply it.`,
    }
  return { kind: "apply" }
}

const planned = Effect.fn("InfraCommand.planned")(function* (root: string) {
  const result = yield* Effect.tryPromise(() => InfraFolder.validate(root))
  if (result.kind === "invalid") return yield* Output.Failure.problems(result.problems)
  if (!result.bindings) {
    return yield* new Output.Failure({
      message: "deploy.yaml: Missing. It names the organization: organization: <slug>.",
    })
  }
  const connection = yield* Connection.Service
  const client = yield* connection.client
  const input = { spec: result.spec, bindings: result.bindings }
  const plan = yield* client.infra.plan(input)
  return { input, plan, organization: result.bindings.organization }
})

export const validate = Effect.fn("InfraCommand.validate")(function* (
  input: Command.Command.Config.Infer<typeof Commands.folder>,
) {
  const result = yield* Effect.tryPromise(() => InfraFolder.validate(resolve(input.folder)))
  if (result.kind === "invalid") return yield* Output.Failure.problems(result.problems)
  const output = yield* Output.Service
  yield* output.result(Schema.Struct({ valid: Schema.Literal(true) }), { valid: true }, "The spec is valid.")
})

export const plan = Effect.fn("InfraCommand.plan")(function* (
  input: Command.Command.Config.Infer<typeof Commands.folder>,
) {
  const result = yield* planned(resolve(input.folder))
  const output = yield* Output.Service
  const changes = render(result.plan)
  yield* output.result(
    Infra.Plan,
    result.plan,
    changes.length > 0 ? [...changes, "", `Digest: ${result.plan.digest}`].join("\n") : "No changes.",
  )
  if (result.plan.problems.length > 0) return yield* Output.Failure.problems(result.plan.problems)
})

export const apply = Effect.fn("InfraCommand.apply")(function* (
  input: Command.Command.Config.Infer<typeof Commands.applyOptions>,
) {
  const result = yield* planned(resolve(input.folder))
  if (result.plan.problems.length > 0) return yield* Output.Failure.problems(result.plan.problems)
  const output = yield* Output.Service
  const decision = gate(result.plan, {
    interactive: output.interactive,
    allowArchive: input.allowArchive,
    ...(Option.isSome(input.plan) ? { digest: input.plan.value } : {}),
  })
  if (decision.kind === "done") return yield* output.result(Infra.Applied, { changes: [] }, decision.message)
  if (decision.kind === "refuse") return yield* new Output.Failure({ message: decision.message })
  if (decision.kind === "confirm") {
    yield* output.diagnostic(render(result.plan).join("\n"))
    if (!(yield* output.confirm(result.organization))) return yield* new Output.Failure({ message: "Apply cancelled." })
  }
  const connection = yield* Connection.Service
  const client = yield* connection.client
  const applied = yield* client.infra.apply({ ...result.input, digest: result.plan.digest })
  yield* output.result(
    Infra.Applied,
    applied,
    [
      ...render(applied),
      `Applied ${applied.changes.length} ${applied.changes.length === 1 ? "change" : "changes"}.`,
    ].join("\n"),
  )
})

export const pull = Effect.fn("InfraCommand.pull")(function* (
  input: Command.Command.Config.Infer<typeof Commands.folder>,
) {
  const connection = yield* Connection.Service
  const output = yield* Output.Service
  const client = yield* connection.client
  const pulled = yield* client.infra.pull()
  const encoded = yield* Schema.encodeEffect(Infra.Pulled)(pulled)
  const root = resolve(input.folder)
  yield* Effect.tryPromise(() => InfraFolder.write(root, encoded))
  yield* output.result(Schema.Struct({ folder: Schema.String }), { folder: root }, `Pulled the org spec into ${root}.`)
})
