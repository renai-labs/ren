export * as InfraCommand from "./command.js"

import { Infra } from "@ren/schema/infra"
import { Effect, Option, Predicate, Result, Schema } from "effect"
import type { Command } from "effect/cli"
import { join, resolve } from "node:path"
import type { Commands } from "../commands.js"
import { Connection } from "../services/connection.js"
import { Output } from "../services/output.js"
import { InfraFolder } from "./folder.js"

const marks = { archive: "-", update: "~", create: "+", conflict: "!", changed: "<", new: "<" } as const

const names = { changed: "changed in Ren", new: "new in Ren" } as const

const largest = 250_000

interface Edit {
  readonly mark: " " | "-" | "+"
  readonly text: string
}

const common = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): Array<Edit> => {
  if (before.length * after.length > largest)
    return [...before.map((text): Edit => ({ mark: "-", text })), ...after.map((text): Edit => ({ mark: "+", text }))]
  const width = after.length + 1
  const table = new Uint32Array((before.length + 1) * width)
  const cell = (left: number, right: number) => table[left * width + right] ?? 0
  for (let left = before.length - 1; left >= 0; left -= 1)
    for (let right = after.length - 1; right >= 0; right -= 1)
      table[left * width + right] =
        before.at(left) === after.at(right)
          ? cell(left + 1, right + 1) + 1
          : Math.max(cell(left + 1, right), cell(left, right + 1))
  const found: Array<Edit> = []
  let left = 0
  let right = 0
  while (left < before.length && right < after.length) {
    const removed = before.at(left) ?? ""
    const added = after.at(right) ?? ""
    if (removed === added) {
      found.push({ mark: " ", text: removed })
      left += 1
      right += 1
    } else if (cell(left + 1, right) >= cell(left, right + 1)) {
      found.push({ mark: "-", text: removed })
      left += 1
    } else {
      found.push({ mark: "+", text: added })
      right += 1
    }
  }
  return [
    ...found,
    ...before.slice(left).map((text): Edit => ({ mark: "-", text })),
    ...after.slice(right).map((text): Edit => ({ mark: "+", text })),
  ]
}

const edits = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): Array<Edit> => {
  const shortest = Math.min(before.length, after.length)
  const indexes = Array.from({ length: shortest }, (_, index) => index)
  const head = indexes.find((index) => before.at(index) !== after.at(index)) ?? shortest
  const tail =
    indexes.slice(0, shortest - head).find((index) => before.at(-1 - index) !== after.at(-1 - index)) ?? shortest - head
  const all = [
    ...before.slice(0, head).map((text): Edit => ({ mark: " ", text })),
    ...common(before.slice(head, before.length - tail), after.slice(head, after.length - tail)),
    ...before.slice(before.length - tail).map((text): Edit => ({ mark: " ", text })),
  ]
  const hidden = (index: number) =>
    all.at(index)?.mark === " " && !all.slice(Math.max(0, index - 1), index + 2).some((edit) => edit.mark !== " ")
  return all.flatMap((edit, index): Array<Edit> => {
    if (!hidden(index)) return [edit]
    return index === 0 || !hidden(index - 1) ? [{ mark: " ", text: "…" }] : []
  })
}

const lines = (text: string | undefined) => (Predicate.isUndefined(text) ? [] : text.split("\n"))

const named = (change: Infra.Change, options: { readonly force: boolean }) => {
  if (change.status === "conflict") return `${options.force ? "force" : "conflict"} ${change.action}`
  if (change.status) return names[change.status]
  return change.action
}

const block = (change: Infra.Change, options: { readonly force: boolean }) => {
  const toFolder = change.status === "changed" || change.status === "new"
  return [
    [
      `${marks[change.status ?? change.action]} ${named(change, options)} ${change.kind} ${change.path}`,
      change.from ? ` (from ${change.from})` : "",
      change.fields.length > 0 ? `: ${change.fields.join(", ")}` : "",
    ].join(""),
    ...(change.values ?? []).flatMap((value) =>
      [
        `    ${value.field}:`,
        edits(lines(toFolder ? value.folder : value.ren), lines(toFolder ? value.ren : value.folder)).map(
          (edit) => `      ${edit.mark} ${edit.text}`,
        ),
      ].flat(),
    ),
  ]
}

export const render = (plan: Pick<Infra.Plan, "changes">, options: { readonly force: boolean } = { force: false }) =>
  [
    ...plan.changes.filter((change) => change.action === "archive"),
    ...plan.changes.filter((change) => change.action !== "archive"),
  ].flatMap((change) => block(change, options))

const applies = (change: Infra.Change) => change.status !== "changed" && change.status !== "new"

export type Gate =
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "refuse"; readonly message: string }
  | { readonly kind: "confirm" }
  | { readonly kind: "apply" }

export const gate = (
  plan: Infra.Plan,
  options: {
    readonly interactive: boolean
    readonly digest?: string
    readonly allowArchive: boolean
    readonly force: boolean
  },
): Gate => {
  if (!plan.changes.some(applies)) return { kind: "done", message: "Nothing to apply." }
  const conflicts = plan.changes.filter((change) => change.status === "conflict").length
  if (conflicts > 0 && !options.force)
    return {
      kind: "refuse",
      message: `${conflicts} ${conflicts === 1 ? "resource" : "resources"} changed in Ren and in the folder. Pull and merge them with git, or pass --force to apply the folder over them.`,
    }
  if (options.interactive) return { kind: "confirm" }
  if (!options.digest)
    return { kind: "refuse", message: "Without a terminal, apply needs --plan <digest> from ren2 infra plan." }
  if (options.digest !== plan.digest)
    return {
      kind: "refuse",
      message: `The plan has changed since digest ${options.digest}. Run ren2 infra plan again.`,
    }
  const archives = plan.changes.filter((change) => change.action === "archive" && applies(change)).length
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
  const input = { spec: result.spec, bindings: result.bindings, lock: result.lock }
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
  input: Command.Command.Config.Infer<typeof Commands.planOptions>,
) {
  const result = yield* planned(resolve(input.folder))
  const output = yield* Output.Service
  const changes = render(result.plan, { force: input.force })
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
  const root = resolve(input.folder)
  const result = yield* planned(root)
  if (result.plan.problems.length > 0) return yield* Output.Failure.problems(result.plan.problems)
  const output = yield* Output.Service
  const decision = gate(result.plan, {
    interactive: output.interactive,
    allowArchive: input.allowArchive,
    force: input.force,
    ...(Option.isSome(input.plan) ? { digest: input.plan.value } : {}),
  })
  if (decision.kind === "done") {
    yield* Effect.tryPromise(() => InfraFolder.writeLock(root, result.plan.lock))
    return yield* output.result(Infra.Applied, { changes: [], lock: result.plan.lock }, decision.message)
  }
  if (decision.kind === "refuse") return yield* new Output.Failure({ message: decision.message })
  if (decision.kind === "confirm") {
    yield* output.diagnostic(render(result.plan, { force: input.force }).join("\n"))
    if (!(yield* output.confirm(result.organization))) return yield* new Output.Failure({ message: "Apply cancelled." })
  }
  const connection = yield* Connection.Service
  const client = yield* connection.client
  const applied = yield* client.infra.apply({ ...result.input, digest: result.plan.digest, force: input.force })
  yield* Effect.tryPromise(() => InfraFolder.writeLock(root, applied.lock))
  yield* output.result(
    Infra.Applied,
    applied,
    [
      ...render(applied, { force: input.force }),
      `Applied ${applied.changes.length} ${applied.changes.length === 1 ? "change" : "changes"}.`,
    ].join("\n"),
  )
})

const lastPull = (root: string) =>
  Result.try(() => Bun.spawnSync(["git", "log", "-1", "--format=%h", "--", "ren.lock"], { cwd: root })).pipe(
    Result.map((run) => (run.success ? run.stdout.toString().trim() : "")),
    Result.getOrElse(() => ""),
  )

export const refusal = (
  conflicts: ReadonlyArray<Infra.Change>,
  options: { readonly folder: string; readonly commit: string },
) =>
  [
    "Pull wrote nothing. These changed in your folder and in Ren (- in Ren, + in your folder):",
    ...conflicts.flatMap((change) => block(change, { force: false })),
    "",
    "To merge them with git, pull on the commit of your last pull, then merge it:",
    `  git switch -c ren-live ${options.commit || "<commit of your last pull>"}`,
    `  ren2 infra pull ${options.folder}`,
    `  git add -A ${options.folder}`,
    '  git commit -m "pull from Ren"',
    "  git switch -",
    "  git merge ren-live",
    "",
    "Or keep your folder and pass --force to ren2 infra apply.",
  ].join("\n")

export const pull = Effect.fn("InfraCommand.pull")(function* (
  input: Command.Command.Config.Infer<typeof Commands.folder>,
) {
  const root = resolve(input.folder)
  const connection = yield* Connection.Service
  const output = yield* Output.Service
  const client = yield* connection.client
  const declared = yield* Effect.promise(() => Bun.file(join(root, "org.yaml")).exists())
  const validated = declared ? yield* Effect.tryPromise(() => InfraFolder.validate(root)) : undefined
  if (validated?.kind === "invalid") return yield* Output.Failure.problems(validated.problems)
  const locked = validated ? undefined : yield* Effect.tryPromise(() => InfraFolder.lock(root))
  if (locked && locked.problems.length > 0) return yield* Output.Failure.problems(locked.problems)
  const pulled = yield* client.infra.pull(
    validated ? { spec: validated.spec, bindings: validated.bindings, lock: validated.lock } : { lock: locked?.lock },
  )
  if (pulled.conflicts.length > 0)
    return yield* new Output.Failure({
      message: refusal(pulled.conflicts, { folder: input.folder, commit: lastPull(root) }),
    })
  const encoded = yield* Schema.encodeEffect(Infra.Pulled)(pulled)
  yield* Effect.tryPromise(() => InfraFolder.write(root, encoded))
  yield* Effect.tryPromise(() => InfraFolder.writeLock(root, pulled.lock))
  const count = pulled.write.length + pulled.remove.length
  yield* output.result(
    Schema.Struct({ folder: Schema.String, write: Schema.Array(Schema.String), remove: Schema.Array(Schema.String) }),
    { folder: root, write: pulled.write, remove: pulled.remove },
    count > 0 ? `Pulled ${count} ${count === 1 ? "change" : "changes"} into ${root}.` : `${root} already matches Ren.`,
  )
})
