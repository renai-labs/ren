import { Effect } from "effect"
import { BrainTest } from "./brain.js"
import { Shared } from "./shared.js"

const database = process.argv[2]
if (!database) throw new Error("Pass the database file")

await Effect.gen(function* () {
  const brain = yield* BrainTest.make({ database })
  yield* brain.start({ interactive: false })
  const script = Shared.stub().script({ hold: true })
  yield* brain.send(`crash ${script.marker}`)
  yield* Effect.promise(() => script.called())
  process.stdout.write(`${brain.id}\n`)
  yield* Effect.never
}).pipe(Effect.scoped, Effect.runPromise)
