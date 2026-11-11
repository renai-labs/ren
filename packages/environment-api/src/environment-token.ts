export * as EnvironmentToken from "./environment-token.js"

import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Schema } from "effect"
import { Signature } from "@ren/schema/signature"

export interface Claims extends Schema.Schema.Type<typeof Claims> {}
export const Claims = Schema.Struct({
  typ: Schema.Literal("environment"),
  kid: Schema.NonEmptyString,
  environment: Environment.ID,
  brain: Brain.ID,
  generation: Schema.optionalKey(Schema.Int).annotate({
    description:
      "The generation of the machine the token is for. An executor that knows its generation refuses a token for another one, so a machine that a shutdown or a replace retired takes no calls from tokens Ren signs later.",
  }),
  exp: Schema.Int,
}).annotate({ identifier: "EnvironmentToken.Claims" })

export const sign = (key: Signature.PrivateKey, claims: Omit<Claims, "typ" | "kid">) =>
  Signature.sign(key, { ...claims, typ: "environment" })

export const verify = (keys: ReadonlyArray<Signature.PublicKey>, token: string) => Signature.verify(keys, Claims, token)
