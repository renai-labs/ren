import { describe, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { AbsolutePath, Agent, Model, Provider, Session, SessionMessage } from "@opencode/client/effect"
import { testEffect } from "@ren/executor/testing"
import { Effect, Fiber, Layer, Option, Schedule, Schema, Stream } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainTest } from "./lib/brain.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"

interface Write {
  readonly n: number
  readonly tbl: "session_v2" | "session_message" | "event_sequence"
  readonly op: "insert" | "update" | "delete"
  readonly sid: string
  readonly old: Record<string, unknown> | null
  readonly new: Record<string, unknown> | null
}

const stub = Shared.stub()

const decodeRow = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

const folder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "opencode-checkpoint-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
)

const columns = (db: Database, table: string) =>
  db
    .query<{ readonly name: string }, []>(`pragma table_info(${table})`)
    .all()
    .map((column) => column.name)

const record = (db: Database) => {
  const json = (row: "OLD" | "NEW", names: ReadonlyArray<string>) =>
    `json_object(${names.map((name) => `'${name}', ${row}.${name}`).join(", ")})`
  const watched = {
    session_v2: { sid: "id", names: columns(db, "session_v2") },
    session_message: { sid: "session_id", names: ["id", "type", "seq"] },
    event_sequence: { sid: "aggregate_id", names: ["seq"] },
  }
  db.run(
    "create table spike_log (n integer primary key autoincrement, tbl text, op text, sid text, old text, new text)",
  )
  for (const entry of Object.entries(watched)) {
    const table = entry[0]
    const sid = entry[1].sid
    const names = entry[1].names
    db.run(`create trigger spike_${table}_insert after insert on ${table} begin
      insert into spike_log (tbl, op, sid, old, new) values ('${table}', 'insert', NEW.${sid}, null, ${json("NEW", names)}); end`)
    db.run(`create trigger spike_${table}_update after update on ${table} begin
      insert into spike_log (tbl, op, sid, old, new) values ('${table}', 'update', NEW.${sid}, ${json("OLD", names)}, ${json("NEW", names)}); end`)
    db.run(`create trigger spike_${table}_delete after delete on ${table} begin
      insert into spike_log (tbl, op, sid, old, new) values ('${table}', 'delete', OLD.${sid}, ${json("OLD", names)}, null); end`)
  }
  const read = (after = 0): ReadonlyArray<Write> =>
    db
      .query<
        { n: number; tbl: Write["tbl"]; op: Write["op"]; sid: string; old: string | null; new: string | null },
        [number]
      >("select * from spike_log where n > ? order by n")
      .all(after)
      .map((row) => ({
        n: row.n,
        tbl: row.tbl,
        op: row.op,
        sid: row.sid,
        old: row.old === null ? null : decodeRow(row.old),
        new: row.new === null ? null : decodeRow(row.new),
      }))
  return { read, mark: () => read().at(-1)?.n ?? 0 }
}

const changed = (write: Write) =>
  write.op === "update"
    ? Object.keys(write.new ?? {}).filter(
        (key) => JSON.stringify(write.old?.[key]) !== JSON.stringify(write.new?.[key]),
      )
    : [write.op]

// oxlint-disable-next-line ren/no-comments -- The log has no transaction boundaries. OpenCode commits a durable event as its projector writes followed by the event_sequence write of the same session (bus.ts commitDurableEvent), so a run of writes of one session that ends with its event_sequence write is covered by E. A run that another session's write or the end of the log ends is not.
const analyze = (log: ReadonlyArray<Write>) => {
  const uncovered: Array<Write> = []
  const regressions: Array<Write> = []
  const run: { sid: string | null; writes: Array<Write> } = { sid: null, writes: [] }
  const flush = () => {
    uncovered.push(...run.writes)
    run.sid = null
    run.writes = []
  }
  for (const write of log) {
    if (write.tbl === "event_sequence") {
      if (write.op === "update" && Number(write.new?.seq) < Number(write.old?.seq)) regressions.push(write)
      if (run.sid === write.sid) {
        run.sid = null
        run.writes = []
      } else flush()
      continue
    }
    if (run.sid !== null && run.sid !== write.sid) flush()
    run.sid = write.sid
    run.writes.push(write)
  }
  flush()
  return {
    messages: uncovered.filter((write) => write.tbl === "session_message"),
    sessions: uncovered
      .filter((write) => write.tbl === "session_v2")
      .map((write) => ({ op: write.op, columns: changed(write) })),
    regressions,
  }
}

const allowed = new Set(["time_suspended", "resume_attempts"])

const expectCovered = (log: ReadonlyArray<Write>) => {
  const result = analyze(log)
  const suspensions = log
    .filter((write) => write.tbl === "session_v2" && changed(write).includes("time_suspended"))
    .map(changed)
  expect(result.messages).toEqual([])
  expect(result.regressions).toEqual([])
  expect(result.sessions.filter((write) => write.columns.some((column) => !allowed.has(column)))).toEqual([])
  expect(suspensions.filter((columns) => columns.some((column) => !allowed.has(column)))).toEqual([])
}

const open = Effect.fnUntraced(function* () {
  const file = join(yield* folder, "opencode.db")
  const brain = yield* BrainTest.make({ database: file })
  const db = new Database(file)
  yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
  yield* brain.start({ interactive: false })
  const log = record(db)
  const client = brain.opencode
  const directory = AbsolutePath.make(brain.directory)
  const create = (input: { readonly parentID?: Session.ID } = {}) =>
    client.session.create({ location: { directory }, ...input }).pipe(Effect.orDie)
  const turn = Effect.fnUntraced(function* (sessionID: Session.ID, script: StubModel.Script, text = "") {
    yield* client.session.prompt({ sessionID, text: `${text} ${script.marker}` }).pipe(Effect.orDie)
    yield* Effect.promise(() => script.called())
    yield* client.session.wait({ sessionID }).pipe(Effect.orDie)
  })
  const shell = Effect.fnUntraced(function* (sessionID: Session.ID, command: string) {
    yield* client.session.shell({ sessionID, command }).pipe(Effect.orDie)
    yield* client.session.wait({ sessionID }).pipe(Effect.orDie)
  })
  const messages = (sessionID: Session.ID) =>
    db
      .query<{ id: string; type: string; seq: number }, [string]>(
        "select id, type, seq from session_message where session_id = ? order by seq, id",
      )
      .all(sessionID)
  return { brain, db, log, client, directory, create, turn, shell, messages }
})

type Opened = Effect.Success<ReturnType<typeof open>>

const it = testEffect(Layer.empty)

const operations: ReadonlyArray<readonly [string, (opened: Opened) => Effect.Effect<unknown>]> = [
  ["a turn", (o) => Effect.flatMap(o.create(), (session) => o.turn(session.id, stub.script()))],
  [
    "a tool call",
    (o) =>
      Effect.flatMap(o.create(), (session) =>
        o.turn(session.id, stub.script({ tool: { name: "skill", input: { name: "missing" } } })),
      ),
  ],
  [
    "a retry",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        const script = stub.script({ status: 503 })
        yield* o.client.session.prompt({ sessionID: session.id, text: script.marker }).pipe(Effect.orDie)
        yield* Effect.promise(() => script.called())
        script.set({})
        yield* Effect.promise(() => script.called(2))
        yield* o.client.session.wait({ sessionID: session.id }).pipe(Effect.orDie)
      }),
  ],
  ["a shell command", (o) => Effect.flatMap(o.create(), (session) => o.shell(session.id, "echo shell"))],
  [
    "a shell that ends after the session is idle",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        const flag = join(o.brain.directory, `release-${session.id}`)
        const shell = yield* Effect.forkChild(
          o.client.session
            .shell({ sessionID: session.id, command: `while [ ! -e ${flag} ]; do sleep 0.01; done; echo ended` })
            .pipe(Effect.orDie),
        )
        yield* Effect.sync(() => o.messages(session.id).some((message) => message.type === "shell")).pipe(
          Effect.repeat({ until: Boolean, schedule: Schedule.spaced("10 millis") }),
        )
        yield* o.turn(session.id, stub.script())
        const idle = o.log.mark()
        yield* Effect.promise(() => Bun.write(flag, ""))
        yield* Fiber.join(shell)
        expect(
          o.log
            .read(idle)
            .filter((write) => write.tbl === "session_message" && write.new?.type === "shell")
            .map((write) => write.op),
        ).toContain("update")
      }),
  ],
  [
    "a revert",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        yield* o.turn(session.id, stub.script())
        yield* o.turn(session.id, stub.script())
        const second = o.messages(session.id).filter((message) => message.type === "user")[1]
        if (!second) return yield* Effect.die(new Error("The second user message is missing"))
        yield* o.client.session.revert
          .stage({ sessionID: session.id, messageID: SessionMessage.ID.make(second.id) })
          .pipe(Effect.orDie)
        yield* o.client.session.revert.commit({ sessionID: session.id }).pipe(Effect.orDie)
      }),
  ],
  [
    "a compaction",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        yield* o.turn(session.id, stub.script())
        yield* o.client.session.compact({ sessionID: session.id }).pipe(Effect.orDie)
        yield* o.client.session.wait({ sessionID: session.id }).pipe(Effect.orDie)
      }),
  ],
  [
    "a title change",
    (o) =>
      Effect.flatMap(o.create(), (session) =>
        o.client.session.update({ sessionID: session.id, title: "Renamed" }).pipe(Effect.orDie),
      ),
  ],
  [
    "an agent switch",
    (o) =>
      Effect.flatMap(o.create(), (session) =>
        o.client.session.switchAgent({ sessionID: session.id, agent: Agent.ID.make("plan") }).pipe(Effect.orDie),
      ),
  ],
  [
    "a model switch",
    (o) =>
      Effect.flatMap(o.create(), (session) =>
        o.client.session
          .switchModel({
            sessionID: session.id,
            model: { providerID: Provider.ID.make("stub"), id: Model.ID.make("stub-other") },
          })
          .pipe(Effect.orDie),
      ),
  ],
  [
    "a change to instructions",
    (o) =>
      Effect.flatMap(o.create(), (session) =>
        o.client.session.instructions.entry
          .put({ sessionID: session.id, key: "ren.test", value: "Answer briefly." })
          .pipe(Effect.orDie),
      ),
  ],
  [
    "a change to permissions",
    (o) =>
      Effect.flatMap(o.create(), (session) =>
        o.client.session
          .update({ sessionID: session.id, permissions: [{ action: "skill", resource: "*", effect: "deny" }] })
          .pipe(Effect.orDie),
      ),
  ],
  [
    "a subagent",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        const child = stub.script()
        yield* o.turn(
          session.id,
          stub.script({
            tool: {
              name: "subagent",
              input: { agent: "general", description: "Look", prompt: `${child.marker} look` },
            },
          }),
        )
        yield* Effect.promise(() => child.called())
      }),
  ],
  [
    "a fork",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        yield* o.turn(session.id, stub.script())
        yield* o.client.session.fork({ sessionID: session.id }).pipe(Effect.orDie)
      }),
  ],
  [
    "an import",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        yield* o.turn(session.id, stub.script())
        const exported = yield* o.client.session.export({ sessionID: session.id }).pipe(Effect.orDie)
        yield* o.client.session.remove({ sessionID: session.id }).pipe(Effect.orDie)
        yield* o.client.session.import({ info: exported.info, messages: exported.messages }).pipe(Effect.orDie)
      }),
  ],
  [
    "a delete",
    (o) =>
      Effect.gen(function* () {
        const session = yield* o.create()
        yield* o.turn(session.id, stub.script())
        yield* o.client.session.remove({ sessionID: session.id }).pipe(Effect.orDie)
      }),
  ],
]

describe("OpenCode checkpoint", () => {
  it.live(
    "the resume of a turn after a crash: each message write changes E, and a session write that leaves E the same changes only time_suspended and resume_attempts",
    () =>
      Effect.gen(function* () {
        const file = join(yield* folder, "opencode.db")
        const child = Bun.spawn(["bun", join(import.meta.dir, "lib/crash-host.ts"), file], {
          stdout: "pipe",
          stderr: "ignore",
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => child.kill("SIGKILL")))
        const line = yield* Stream.fromReadableStream({ evaluate: () => child.stdout, onError: (cause) => cause }).pipe(
          Stream.decodeText,
          Stream.splitLines,
          Stream.filter((output) => /^ses_\w+$/.test(output)),
          Stream.runHead,
          Effect.orDie,
        )
        if (Option.isNone(line)) return yield* Effect.die(new Error("The crash host exited before it started a turn"))
        const sessionID = Session.ID.make(line.value)
        child.kill("SIGKILL")
        yield* Effect.promise(() => child.exited)
        const db = new Database(file)
        yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
        const log = record(db)
        const resumed = stub.waitFor((call) => call.text === StubModel.restarted)
        const brain = yield* BrainTest.make({ database: file })
        yield* Effect.promise(() => resumed)
        yield* brain.opencode.session.wait({ sessionID }).pipe(Effect.orDie)
        const writes = log.read()
        expect(writes.some((write) => write.tbl === "session_message" && write.sid === sessionID)).toBe(true)
        expectCovered(writes)
      }),
    60_000,
  )

  for (const operation of operations)
    it.live(
      `${operation[0]}: each message write changes E of its session, and a session write that leaves E the same changes only time_suspended and resume_attempts`,
      () =>
        Effect.gen(function* () {
          const opened = yield* open()
          const from = opened.log.mark()
          yield* operation[1](opened)
          expectCovered(opened.log.read(from))
        }),
      60_000,
    )

  it.live(
    "a second read-only connection reads E, L and the rows in one read transaction during a turn, with no SQLITE_BUSY",
    () =>
      Effect.gen(function* () {
        const opened = yield* open()
        const reader = new Database(opened.db.filename, { readonly: true })
        yield* Effect.addFinalizer(() => Effect.sync(() => reader.close()))
        const session = yield* opened.create()
        const script = stub.script({ reply: "word ".repeat(300), dripMs: 1 })
        const read = Effect.sync(() => {
          reader.run("begin")
          const sequence = reader
            .query<{ seq: number }, [string]>("select seq from event_sequence where aggregate_id = ?")
            .get(session.id)
          const ids = reader
            .query<{ id: string }, [string]>("select id from session_message where session_id = ? order by seq, id")
            .all(session.id)
          const rows = ids.filter(
            (row) =>
              reader
                .query<{ id: string }, [string, string]>(
                  "select id from session_message where session_id = ? and id = ?",
                )
                .get(session.id, row.id) !== null,
          )
          reader.run("commit")
          return { seq: sequence?.seq ?? null, listed: ids.length, read: rows.length }
        })
        yield* opened.client.session.prompt({ sessionID: session.id, text: script.marker }).pipe(Effect.orDie)
        yield* Effect.promise(() => script.called())
        const idle = () =>
          opened.log.read().some((write) => write.tbl === "session_message" && write.new?.type === "idle")
        const counted = { reads: 0, writesDuring: opened.log.mark() }
        yield* read.pipe(
          Effect.tap(() => Effect.sync(() => counted.reads++)),
          Effect.andThen(Effect.yieldNow),
          Effect.repeat({ while: () => !idle() }),
        )
        const reads = yield* read
        expect(opened.db.query<{ journal_mode: string }, []>("pragma journal_mode").get()?.journal_mode).toBe("wal")
        expect(counted.reads).toBeGreaterThan(10)
        expect(opened.log.read(counted.writesDuring).length).toBeGreaterThan(10)
        expect(reads.listed).toBe(reads.read)
        expect(reads.seq).toBe(
          opened.db
            .query<{ seq: number }, [string]>("select seq from event_sequence where aggregate_id = ?")
            .get(session.id)?.seq ?? null,
        )
      }),
    60_000,
  )

  it.live("a read-only connection opened before OpenCode made its tables finds them after", () =>
    Effect.gen(function* () {
      const file = join(yield* folder, "opencode.db")
      yield* Effect.promise(() => Bun.write(file, ""))
      const reader = new Database(file, { readonly: true })
      yield* Effect.addFinalizer(() => Effect.sync(() => reader.close()))
      const tables = () =>
        reader
          .query<{ name: string }, []>(
            "select name from sqlite_master where type = 'table' and name in ('session_v2', 'session_message', 'event_sequence') order by name",
          )
          .all()
          .map((row) => row.name)
      expect(tables()).toEqual([])
      yield* BrainTest.make({ database: file })
      expect(tables()).toEqual(["event_sequence", "session_message", "session_v2"])
    }),
  )
})
