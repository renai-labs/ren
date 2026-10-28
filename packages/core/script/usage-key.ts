import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { Effect, Layer, Redacted } from "effect"
import { Usage } from "../src/usage.js"

const producer = Bun.argv.at(2)
if (!producer) throw new Error("usage: bun script/usage-key.ts <producer>")

const key = await Effect.runPromise(
  Usage.issueKey(producer).pipe(Effect.provide(Database.layer.pipe(Layer.provide(Postgres.layer)))),
)
process.stdout.write(`${Redacted.value(key.secret)}\n`)
