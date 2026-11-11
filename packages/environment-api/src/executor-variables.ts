export * as ExecutorVariables from "./executor-variables.js"

import type { Environment } from "@ren/schema/environment"
import { Schema } from "effect"
import { Signature } from "@ren/schema/signature"

export const environmentId = "EXECUTOR_ENVIRONMENT_ID"

export const publicKeys = "ENVIRONMENT_PUBLIC_KEYS"

export const generation = "EXECUTOR_ENVIRONMENT_GENERATION"

export const make = (
  environment: Environment.ID,
  keys: readonly [Signature.PublicKey, ...ReadonlyArray<Signature.PublicKey>],
  options: { readonly generation?: number } = {},
): Readonly<Record<string, string>> => ({
  [environmentId]: environment,
  [publicKeys]: Schema.encodeSync(Signature.PublicKeys)(keys),
  ...(options.generation && { [generation]: String(options.generation) }),
})
