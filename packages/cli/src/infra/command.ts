/* oxlint-disable no-console -- the CLI writes its results to the terminal */
export * as InfraCommand from "./command.js"

import { Infra } from "@ren/schema/infra"
import { Schema } from "effect"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { Connection } from "../connection.js"
import { InfraFolder } from "./folder.js"

export const usage = "Usage: ren infra <validate|plan|apply|pull> [folder] [--plan <digest>] [--allow-archive]"

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
    return { kind: "refuse", message: "Without a terminal, apply needs --plan <digest> from ren infra plan." }
  if (options.digest !== plan.digest)
    return {
      kind: "refuse",
      message: `The plan has changed since digest ${options.digest}. Run ren infra plan again.`,
    }
  const archives = plan.changes.filter((change) => change.action === "archive").length
  if (archives > 0 && !options.allowArchive)
    return {
      kind: "refuse",
      message: `The plan archives ${archives} ${archives === 1 ? "row" : "rows"}. Pass --allow-archive to apply it.`,
    }
  return { kind: "apply" }
}

const planned = async (root: string) => {
  const result = await InfraFolder.validate(root)
  if (result.kind === "invalid") {
    console.error(result.problems.map(InfraFolder.format).join("\n"))
    return
  }
  if (!result.bindings) {
    console.error("deploy.yaml: Missing. It names the organization: organization: <slug>.")
    return
  }
  const input = { spec: result.spec, bindings: result.bindings }
  const plan = await Connection.run((client) => client.infra.plan(input))
  console.log(render(plan).join("\n") || "No changes.")
  if (plan.problems.length > 0) {
    console.error(plan.problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n"))
    return
  }
  return { input, plan, organization: result.bindings.organization }
}

interface Options {
  readonly plan?: string | undefined
  readonly allowArchive: boolean
}

const commands: Record<string, (root: string, options: Options) => Promise<number>> = {
  validate: async (root) => {
    const result = await InfraFolder.validate(root)
    if (result.kind === "invalid") {
      console.error(result.problems.map(InfraFolder.format).join("\n"))
      return 1
    }
    console.log("The spec is valid.")
    return 0
  },
  plan: async (root) => {
    const result = await planned(root)
    if (!result) return 1
    if (result.plan.changes.length > 0) console.log(`\nDigest: ${result.plan.digest}`)
    return 0
  },
  apply: async (root, options) => {
    const result = await planned(root)
    if (!result) return 1
    const decision = gate(result.plan, {
      interactive: process.stdin.isTTY,
      allowArchive: options.allowArchive,
      ...(options.plan ? { digest: options.plan } : {}),
    })
    if (decision.kind === "done") console.log(decision.message)
    if (decision.kind === "refuse") console.error(decision.message)
    if (decision.kind === "done" || decision.kind === "refuse") return decision.kind === "done" ? 0 : 1
    if (decision.kind === "confirm" && prompt(`\nType ${result.organization} to apply:`) !== result.organization) {
      console.error("Apply cancelled.")
      return 1
    }
    const applied = await Connection.run((client) =>
      client.infra.apply({ ...result.input, digest: result.plan.digest }),
    )
    console.log(`Applied ${applied.changes.length} ${applied.changes.length === 1 ? "change" : "changes"}.`)
    return 0
  },
  pull: async (root) => {
    const pulled = await Connection.run((client) => client.infra.pull())
    await InfraFolder.write(root, await Schema.encodePromise(Infra.Pulled)(pulled))
    console.log(`Pulled the org spec into ${root}.`)
    return 0
  },
}

export const run = async (args: ReadonlyArray<string>) => {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { plan: { type: "string" }, "allow-archive": { type: "boolean", default: false } },
  })
  const name = parsed.positionals.at(0)
  const command = name && Object.hasOwn(commands, name) ? commands[name] : undefined
  if (!command) {
    console.error(name ? `Unknown command: infra ${name}\n${usage}` : usage)
    return 1
  }
  return command(resolve(parsed.positionals.at(1) ?? ".ren"), {
    plan: parsed.values.plan,
    allowArchive: parsed.values["allow-archive"],
  })
}
