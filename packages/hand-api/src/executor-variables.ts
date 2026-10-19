export * as ExecutorVariables from "./executor-variables.js"

import type { Hand } from "@ren/schema/hand"
import { Schema } from "effect"
import { Signature } from "./signature.js"

export const handId = "EXECUTOR_HAND_ID"

export const publicKeys = "HAND_PUBLIC_KEYS"

export const make = (
  hand: Hand.ID,
  keys: readonly [Signature.PublicKey, ...ReadonlyArray<Signature.PublicKey>],
): Readonly<Record<string, string>> => ({
  [handId]: hand,
  [publicKeys]: Schema.encodeSync(Signature.PublicKeys)(keys),
})
