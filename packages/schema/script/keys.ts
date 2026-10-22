import { Signature } from "../src/signature.js"
import { Effect, Schema } from "effect"

const id = Bun.argv.at(2) ?? new Date().toISOString().slice(0, 10)
const brain = await Effect.runPromise(Signature.generate(`brain-${id}`))
const environment = await Effect.runPromise(Signature.generate(`environment-${id}`))
console.log(`BRAIN_KEYS='${Schema.encodeSync(Signature.PrivateKeys)([brain.privateKey])}'`)
console.log(`ENVIRONMENT_KEYS='${Schema.encodeSync(Signature.PrivateKeys)([environment.privateKey])}'`)
