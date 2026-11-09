export * as TestToken from "./token.js"

import { BrainToken } from "@ren/host-api/brain-token"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { Effect, Schema } from "effect"

const active = await Effect.runPromise(Signature.generate("active"))
const retiring = await Effect.runPromise(Signature.generate("retiring"))

export const keys = [active.privateKey, retiring.privateKey] as const

export const publicKeys = [active.publicKey, retiring.publicKey] as const

export const vars = { BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)(publicKeys) }

export const brain = Brain.ID.make("brn_test")

type Unsigned = Parameters<typeof BrainToken.sign>[1]

export const sign = (claims: Unsigned, key: Signature.PrivateKey = keys[0]) =>
  Effect.runPromise(BrainToken.sign(key, claims))

export const exp = (seconds = 600) => Math.floor(Date.now() / 1000) + seconds

export const basic = (token: string, user = "opencode") => `Basic ${btoa(`${user}:${token}`)}`
