import { readdir } from "node:fs/promises"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { Settings } from "@ren/schema/settings"
import { Effect, Layer, Schema } from "effect"
import { RenSettings } from "../src/settings/ren.js"

const AgentFile = Schema.Struct({
  description: Schema.NonEmptyString,
  isSubagent: Schema.Boolean,
  settings: Settings.Info,
})

const directory = new URL("../ren/", import.meta.url).pathname

const decode = <S extends Schema.Top>(schema: S, path: string) =>
  Effect.flatMap(
    Effect.promise(() => Bun.file(`${directory}${path}`).text()),
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema)),
  )

const program = Effect.gen(function* () {
  const database = yield* Database.Service
  const files = yield* Effect.promise(() => readdir(`${directory}agents`))
  const defaults = {
    settings: yield* decode(Settings.Info, "settings.json"),
    agents: yield* Effect.forEach(
      files.filter((file) => file.endsWith(".json")),
      (file) =>
        Effect.gen(function* () {
          const agent = yield* decode(AgentFile, `agents/${file}`)
          return { ...agent, name: file.slice(0, -".json".length) }
        }),
    ),
  }
  yield* database.transaction((transaction) => RenSettings.apply(transaction, defaults))
  yield* Effect.log(
    `Wrote the Ren settings and ${defaults.agents.length} agents. Sessions apply them at their next turn.`,
  )
})

await Effect.runPromise(program.pipe(Effect.provide(Database.layer.pipe(Layer.provide(Postgres.layer)))))
