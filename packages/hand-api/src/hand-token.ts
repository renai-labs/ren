export * as HandToken from "./hand-token.js"

import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Schema } from "effect"
import { Signature } from "./signature.js"

export interface Claims extends Schema.Schema.Type<typeof Claims> {}
export const Claims = Schema.Struct({
  typ: Schema.Literal("hand"),
  kid: Schema.NonEmptyString,
  hand: Hand.ID,
  brain: Brain.ID,
  exp: Schema.Int,
}).annotate({ identifier: "HandToken.Claims" })

export const sign = (key: Signature.PrivateKey, claims: Omit<Claims, "typ" | "kid">) =>
  Signature.sign(key, { ...claims, typ: "hand" })

export const verify = (keys: ReadonlyArray<Signature.PublicKey>, token: string) => Signature.verify(keys, Claims, token)
