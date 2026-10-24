import { parseArgs } from "node:util"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { Effect, Layer, Schema } from "effect"
import { Access } from "../src/access.js"
import { AppRegistry } from "../src/app/registry.js"

const usage = `Usage:
  bun run publish-apps <batch.json> [--dry-run]   publish a compiled batch of registry apps
  bun run publish-apps --withdraw <slug>          hide a listing from discovery and new installs
  bun run publish-apps --relist <slug>            list a withdrawn app again`

const args = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean" }, withdraw: { type: "string" }, relist: { type: "string" } },
})

const program = Effect.gen(function* () {
  const registry = yield* AppRegistry.Service
  if (args.values.withdraw) {
    yield* registry.withdraw(args.values.withdraw)
    return yield* Effect.log(`Withdrew ${args.values.withdraw}. Existing installations keep working.`)
  }
  if (args.values.relist) {
    yield* registry.relist(args.values.relist)
    return yield* Effect.log(`Listed ${args.values.relist}.`)
  }
  const path = args.positionals.at(0)
  if (!path) return yield* Effect.die(new Error(usage))
  const batch = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(AppRegistry.Batch))(
    yield* Effect.promise(() => Bun.file(path).text()),
  )
  const isDryRun = args.values["dry-run"] === true
  const result = yield* registry.publish(batch, { isDryRun })
  yield* Effect.forEach(result.apps, (app) => {
    const changes = Object.entries(app.changed).flatMap((entry) => (entry[1] ? [entry[0]] : []))
    return Effect.log(
      `${app.slug} revision ${app.revision} ${app.appId}: ${changes.length ? changes.join(", ") : "unchanged"}`,
    )
  })
  yield* Effect.log(`${isDryRun ? "Dry run: would publish" : "Published"} ${result.apps.length} apps.`)
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(AppRegistry.layer),
    Effect.provide(Access.layer),
    Effect.provide(Database.layer.pipe(Layer.provide(Postgres.layer))),
  ),
)
