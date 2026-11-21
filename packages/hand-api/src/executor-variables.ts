export * as ExecutorVariables from "./executor-variables.js"

import type { Hand } from "@ren/schema/hand"
import { Schema } from "effect"
import { Signature } from "@ren/schema/signature"

export const environmentId = "EXECUTOR_ENVIRONMENT_ID"

export const publicKeys = "ENVIRONMENT_PUBLIC_KEYS"

export const generation = "EXECUTOR_ENVIRONMENT_GENERATION"

// oxlint-disable-next-line ren/no-comments -- The names of the variables Ren gave the machine for its own processes, comma-separated. The executor removes them from the commands it runs, so the agent's programs never get Ren's telemetry, keys or settings.
export const hidden = "EXECUTOR_HIDDEN_VARIABLES"

// oxlint-disable-next-line ren/no-comments -- Ren gives these to the agent's commands on purpose: where Ren is, and that its traffic goes through the egress.
const forCommands: ReadonlySet<string> = new Set(["REN_URL", "REN_EGRESS"])

export const hiddenIn = (variables: Readonly<Record<string, string | undefined>>): ReadonlyArray<string> =>
  (variables[hidden] ?? "").split(",").filter((name) => name.length > 0)

export const hiding = (names: ReadonlyArray<string>): Readonly<Record<string, string>> => ({
  [hidden]: [...new Set(names)].filter((name) => !forCommands.has(name)).join(","),
})

export const make = (
  environment: Hand.ID,
  keys: readonly [Signature.PublicKey, ...ReadonlyArray<Signature.PublicKey>],
  options: { readonly generation?: number } = {},
): Readonly<Record<string, string>> => ({
  [environmentId]: environment,
  [publicKeys]: Schema.encodeSync(Signature.PublicKeys)(keys),
  ...(options.generation && { [generation]: String(options.generation) }),
})
