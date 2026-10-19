import { Effect, Schema } from "effect"
import { Signature } from "../src/signature.js"

const keyPair = await Effect.runPromise(Signature.generate(Bun.argv.at(2) ?? new Date().toISOString().slice(0, 10)))
console.log(`BRAIN_SIGNING_KEY='${Schema.encodeSync(Signature.SigningKey)(keyPair.privateKey)}'`)
console.log(`BRAIN_PUBLIC_KEYS='${Schema.encodeSync(Signature.PublicKeys)([keyPair.publicKey])}'`)
