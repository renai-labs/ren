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

export const render = (plan: Infra.Plan) => [
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
  if (result.kind === "invalid") {
    return yield* Effect.fail(new Error(result.problems.map(InfraFolder.format).join("\n")))
  }
  if (!result.bindings) {
    return yield* Effect.fail(new Error("deploy.yaml: Missing. It names the organization: organization: <slug>."))
  }
  const connection = yield* Connection.Service
  const output = yield* Output.Service
  const client = yield* connection.client
  const input = { spec: result.spec, bindings: result.bindings }
  const plan = yield* client.infra.plan(input)
  yield* output.result(render(plan).join("\n") || "No changes.")
  if (plan.problems.length > 0) {
    return yield* Effect.fail(
      new Error(plan.problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n")),
    )
  }
  return { input, plan, organization: result.bindings.organization }
})

export const validate = Effect.fn("InfraCommand.validate")(function* (
  input: Command.Command.Config.Infer<typeof Commands.folder>,
) {
  const result = yield* Effect.tryPromise(() => InfraFolder.validate(resolve(input.folder)))
  if (result.kind === "invalid") {
    return yield* Effect.fail(new Error(result.problems.map(InfraFolder.format).join("\n")))
  }
  const output = yield* Output.Service
  yield* output.result("The spec is valid.")
})

export const plan = Effect.fn("InfraCommand.plan")(function* (
  input: Command.Command.Config.Infer<typeof Commands.folder>,
) {
  const result = yield* planned(resolve(input.folder))
  const output = yield* Output.Service
  if (result.plan.changes.length > 0) yield* output.result(`\nDigest: ${result.plan.digest}`)
})

export const apply = Effect.fn("InfraCommand.apply")(function* (
  input: Command.Command.Config.Infer<typeof Commands.applyOptions>,
) {
  const result = yield* planned(resolve(input.folder))
  const output = yield* Output.Service
  const decision = gate(result.plan, {
    interactive: output.interactive,
    allowArchive: input.allowArchive,
    ...(Option.isSome(input.plan) ? { digest: input.plan.value } : {}),
  })
  if (decision.kind === "done") return yield* output.result(decision.message)
  if (decision.kind === "refuse") return yield* Effect.fail(new Error(decision.message))
  if (decision.kind === "confirm" && !(yield* output.confirm(result.organization))) {
    return yield* Effect.fail(new Error("Apply cancelled."))
  }
  const connection = yield* Connection.Service
  const client = yield* connection.client
  const applied = yield* client.infra.apply({ ...result.input, digest: result.plan.digest })
  yield* output.result(`Applied ${applied.changes.length} ${applied.changes.length === 1 ? "change" : "changes"}.`)
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
  yield* output.result(`Pulled the org spec into ${root}.`)
})
