import { Database } from "bun:sqlite"
import { SessionID } from "@opencode/schema/session-id"
import { OpenCodeFixtures } from "@ren/opencode-transcript/testing"
import { Sync } from "@ren/schema/sync"
import { Effect, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeVersion } from "../../src/harness/opencode/version.js"
import { BrainTest } from "./brain.js"
import { Shared } from "./shared.js"
import { OpenCodeSnapshot } from "./opencode-snapshot.js"
import type { StubModel } from "./stub-model.js"

const summary = "## Objective\n- the summary"

const columns = (schema: { readonly fields: object }) => Object.keys(schema.fields).join(", ")

const record = Effect.gen(function* () {
  const file = `${OpenCodeFixtures.directory}${OpenCodeVersion.installed}.json`
  const snapshotFile = new URL(`../fixtures/databases/${OpenCodeVersion.installed}.json`, import.meta.url).pathname
  const databaseOnly = process.argv.includes("--database")
  if (!databaseOnly && (yield* Effect.promise(() => Bun.file(file).exists())))
    return yield* Effect.die(new Error(`Recording ${file} already exists; historical recordings are immutable`))
  if (yield* Effect.promise(() => Bun.file(snapshotFile).exists()))
    return yield* Effect.die(new Error(`Recording ${snapshotFile} already exists; historical recordings are immutable`))
  const stub = Shared.stub()
  const folder = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-opencode-record-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const database = join(folder, "opencode.db")
  const brain = yield* BrainTest.make({ database })
  yield* brain.start()
  const turn = Effect.fnUntraced(function* (
    behaviour: Parameters<StubModel.Server["script"]>[0],
    input: Parameters<typeof brain.send>[1] = {},
  ) {
    yield* brain.send(stub.script({ summary, ...behaviour }).marker, input)
    yield* brain.driver.wait(brain.id)
  })

  const child = stub.script({ summary, reasoning: "Reading the files" })
  yield* turn({
    reasoning: "Planning the look",
    tool: { name: "subagent", input: { agent: "general", description: "Look", prompt: `${child.marker} look` } },
  })
  yield* turn({ tool: { name: "skill", input: { name: "missing" } } })
  yield* turn({}, { channel: { provider: "slack", place: "C0RECORD", sender: "U0RECORD" } })
  yield* brain.driver.shell(brain.id, "echo recorded")
  yield* brain.driver.wait(brain.id)
  const reset = stub.script({ summary })
  yield* brain.opencode.session.synthetic({
    sessionID: SessionID.make(brain.id),
    text: `${reset.marker} The chat's workspace files were lost.`,
    metadata: { source: "ren.files-reset" },
  })
  yield* Effect.promise(() => reset.called())
  yield* brain.driver.wait(brain.id)
  yield* turn({ status: 400 })
  yield* brain.opencode.session.compact({ sessionID: SessionID.make(brain.id) })
  yield* brain.driver.wait(brain.id)

  const snapshotDatabase = new Database(database, { readonly: true })
  const snapshot = snapshotDatabase.transaction(() => {
    const definitions = Schema.decodeUnknownSync(
      Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String, sql: Schema.String })),
    )(
      snapshotDatabase
        .query(
          "select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by rowid",
        )
        .all(),
    )
    return Schema.decodeUnknownSync(OpenCodeSnapshot.Snapshot)({
      version: OpenCodeVersion.installed,
      root: brain.id,
      tables: definitions
        .filter((entry) => entry.type === "table")
        .map((entry) => ({
          name: entry.name,
          sql: entry.sql,
          rows: snapshotDatabase.query(`select * from "${entry.name.replaceAll('"', '""')}"`).all(),
        })),
      indexes: definitions.filter((entry) => entry.type !== "table").map((entry) => entry.sql),
    })
  })()
  snapshotDatabase.close()
  yield* Effect.promise(() => Bun.write(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`))
  if (databaseOnly) return

  const busy = yield* brain.driver.create()
  const held = stub.script({ summary, hold: true })
  yield* Effect.addFinalizer(() => Effect.sync(held.release))
  yield* brain.driver.prompt(busy, held.marker)
  yield* Effect.promise(() => held.called())
  yield* brain.opencode.session.prompt({
    sessionID: SessionID.make(busy),
    text: "Queued while busy",
    delivery: "queue",
  })
  yield* brain.opencode.session.synthetic({
    sessionID: SessionID.make(busy),
    text: "The chat's workspace files were lost.",
    metadata: { source: "ren.files-reset" },
    resume: false,
  })

  const sqlite = new Database(database, { readonly: true })
  const sessions = Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeSessionRow))(
    sqlite.query(`select ${columns(Sync.OpenCodeSessionRow)} from session_v2 order by time_created, id`).all(),
  )
  const recording = Schema.encodeSync(OpenCodeFixtures.Recording)({
    version: OpenCodeVersion.installed,
    chats: sessions.map((session) => ({
      session,
      messages: Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeMessageRow))(
        sqlite
          .query(
            `select ${columns(Sync.OpenCodeMessageRow)} from session_message where session_id = ? order by seq, id`,
          )
          .all(session.id),
      ),
      inbox: Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeInboxRow))(
        sqlite
          .query(
            `select ${columns(Sync.OpenCodeInboxRow)} from session_inbox where session_id = ? order by enqueued_seq`,
          )
          .all(session.id),
      ),
    })),
  })
  sqlite.close()
  yield* Effect.promise(() => Bun.write(file, `${JSON.stringify(recording, null, 2)}\n`))
  yield* Effect.log(`Recorded ${recording.chats.length} chats of OpenCode ${recording.version} in ${file}`)
})

await Effect.runPromise(Effect.scoped(record).pipe(Effect.ensuring(Effect.promise(Shared.dispose))))
