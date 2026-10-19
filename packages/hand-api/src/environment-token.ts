export * as EnvironmentToken from "./environment-token.js"

import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Schema } from "effect"
import { Signature } from "./signature.js"

export interface Claims extends Schema.Schema.Type<typeof Claims> {}
export const Claims = Schema.Struct({
  typ: Schema.Literal("environment"),
  kid: Schema.NonEmptyString,
  env: Environment.ID,
  brain: Brain.ID,
  exp: Schema.Int,
}).annotate({ identifier: "EnvironmentToken.Claims" })

export const sign = (key: Signature.PrivateKey, claims: Omit<Claims, "typ" | "kid">) =>
  Signature.sign(key, { ...claims, typ: "environment" })

export const verify = (keys: ReadonlyArray<Signature.PublicKey>, token: string) => Signature.verify(keys, Claims, token)
