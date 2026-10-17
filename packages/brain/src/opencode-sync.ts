export * as OpenCodeSync from "./opencode-sync.js"

import { maxBodyBytes, OpenCodeMessageRow, OpenCodeSessionRow, SyncApi } from "@ren/brain-api/sync-api"
import { Session } from "@ren/schema/session"
import { Clock, Duration, Effect, Metric, Option, Predicate, Record, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"

export type Binding = string | number | null

export type Query = (sql: string, ...bindings: ReadonlyArray<Binding>) => Iterable<unknown>

export interface Reader {
  readonly read: <A>(read: (query: Query) => A) => A
}

export interface Options {
  readonly url: string
  readonly token: Effect.Effect<string>
  readonly reader: Reader
  readonly restoring: Effect.Effect<boolean>
}

export class SyncError extends Schema.TaggedError<SyncError>()("OpenCodeSync.SyncError", {
  reason: Schema.Literals(["incompatible", "read", "unavailable"]),
  message: Schema.String,
}) {}

export interface Step {
  readonly drained: boolean
  readonly failed?: boolean
  readonly throttledUntil?: number
}

export interface Interface {
  readonly step: (options?: { readonly deadline?: number }) => Effect.Effect<Step, SyncError>
  readonly exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export const busyInterval = Duration.minutes(5)

export const oversizedRows = Metric.counter("opencode_sync_oversized_rows", {
  description: "Message rows that a sync pass could not send because they are larger than the SyncApi body limit.",
  incremental: true,
})

const batchRows = 500

const batchBytes = 1024 * 1024

const envelopeBytes = JSON.stringify({ messages: [] }).length

const sessionColumns = Object.keys(OpenCodeSessionRow.fields)

const messageColumns = Object.keys(OpenCodeMessageRow.fields)

const tables = [
  { name: "session_v2", columns: sessionColumns },
  { name: "session_message", columns: messageColumns },
  { name: "event_sequence", columns: ["aggregate_id", "seq"] },
]

const Local = Schema.Struct({
  id: Session.ID,
  parent_id: Schema.NullOr(Session.ID),
  time_suspended: Schema.NullOr(Schema.Int),
  seq: Schema.Int,
})

type Local = typeof Local.Type

const Tables = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    columns: Schema.Array(Schema.String),
    present: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
)

const Snapshot = Schema.Struct({
  seq: Schema.Array(Schema.Struct({ seq: Schema.Int })),
  ids: Schema.Array(Schema.Struct({ id: Schema.String })),
})

const encoder = new TextEncoder()

const withoutNul = (row: unknown) =>
  Predicate.isObject(row)
    ? Record.map(row, (value) => (typeof value === "string" ? value.replaceAll("\u0000", "\uFFFD") : value))
    : row

export const make = Effect.fn("OpenCodeSync.make")(function* (options: Options) {
  const http = yield* HttpClient.HttpClient
  const client = yield* HttpApiClient.makeWith(SyncApi, {
    baseUrl: options.url,
    httpClient: HttpClient.mapRequestEffect(http, (request) =>
      Effect.map(options.token, (token) => HttpClientRequest.bearerToken(request, token)),
    ),
  })
  const sync = client.sync
  const running = yield* Semaphore.make(1)
  const refused = new Set<Session.ID>()
  const lastPass = new Map<Session.ID, number>()

  const read = <A>(evaluate: (query: Query) => A) =>
    Effect.try({
      try: () => options.reader.read(evaluate),
      catch: (cause) => new SyncError({ reason: "read", message: `The host database read failed: ${String(cause)}` }),
    })

  const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        (error) => new SyncError({ reason: "read", message: `A host database row is invalid: ${error.message}` }),
      ),
    )

  const first = <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    sql: string,
    ...bindings: ReadonlyArray<Binding>
  ) =>
    read((query) => [...query(sql, ...bindings)]).pipe(
      Effect.flatMap((rows) => decode(Schema.Array(schema), rows.map(withoutNul))),
      Effect.map((rows) => Option.fromNullishOr(rows.at(0))),
    )

  const start = (session: Local, known: boolean) =>
    sync["sync.startUpload"]({
      params: { id: session.id },
      payload: { harness: "opencode", parentId: session.parent_id },
    }).pipe(
      Effect.map((started) => Option.some(started.upload)),
      Effect.catchTag("ForbiddenError", (error) => {
        if (session.parent_id || known) return Effect.fail(error)
        refused.add(session.id)
        return Effect.logWarning(
          `Ren refused the unknown root session ${session.id}. It does not sync in this process.`,
        ).pipe(Effect.as(Option.none()))
      }),
    )

  const upload = Effect.fnUntraced(function* (
    params: { readonly id: Session.ID; readonly upload: number },
    ids: ReadonlyArray<{ readonly id: string }>,
  ) {
    const send = (messages: ReadonlyArray<OpenCodeMessageRow>) =>
      sync["sync.uploadMessages"]({ params, payload: { messages } })
    const sent: Array<string> = []
    let rows: Array<OpenCodeMessageRow> = []
    let bytes = envelopeBytes
    for (const message of ids) {
      const row = yield* first(
        OpenCodeMessageRow,
        `select ${messageColumns.join(", ")} from session_message where session_id = ? and id = ?`,
        params.id,
        message.id,
      )
      if (Option.isNone(row)) continue
      const size = encoder.encode(JSON.stringify(row.value)).length
      if (envelopeBytes + size > maxBodyBytes) {
        yield* Metric.update(oversizedRows, 1)
        yield* Effect.logError(
          `Message ${message.id} is ${size} bytes as JSON, more than the ${maxBodyBytes} bytes that Ren accepts. The session cannot sync.`,
        )
        return Option.none()
      }
      if (rows.length >= batchRows || (rows.length > 0 && bytes + 1 + size > batchBytes)) {
        yield* send(rows)
        rows = []
        bytes = envelopeBytes
      }
      bytes += size + (rows.length > 0 ? 1 : 0)
      rows.push(row.value)
      sent.push(message.id)
    }
    if (rows.length > 0) yield* send(rows)
    return Option.some(sent)
  })

  const pass = Effect.fnUntraced(function* (session: Local, known: boolean) {
    const started = yield* start(session, known)
    if (Option.isNone(started)) return "refused" as const
    const params = { id: session.id, upload: started.value }
    const snapshot = yield* read((query) => ({
      seq: [...query("select seq from event_sequence where aggregate_id = ?", session.id)],
      ids: [...query("select id from session_message where session_id = ? order by seq, id", session.id)],
    })).pipe(Effect.flatMap((rows) => decode(Snapshot, rows)))
    const latest = snapshot.seq.at(0)
    if (!latest) return "failed" as const
    const sent = yield* upload(params, snapshot.ids)
    if (Option.isNone(sent)) return "failed" as const
    const row = yield* first(
      OpenCodeSessionRow,
      `select ${sessionColumns.join(", ")} from session_v2 where id = ?`,
      session.id,
    )
    if (Option.isNone(row)) return "failed" as const
    yield* sync["sync.commit"]({ params, payload: { session: row.value, seq: latest.seq, ids: sent.value } })
    return "committed" as const
  })

  const hasTables = Effect.gen(function* () {
    const found = yield* read((query) =>
      tables.map((table) => ({
        name: table.name,
        columns: table.columns,
        present: [...query(`pragma table_info(${table.name})`)],
      })),
    ).pipe(Effect.flatMap((rows) => decode(Tables, rows)))
    if (found.every((table) => table.present.length === 0)) return false
    const missing = found.flatMap((table) =>
      table.columns
        .filter((column) => !table.present.some((present) => present.name === column))
        .map((column) => `${table.name}.${column}`),
    )
    if (missing.length === 0) return true
    const message = `The OpenCode tables do not have the columns that sync reads: ${missing.join(", ")}`
    yield* Effect.logError(message)
    return yield* new SyncError({ reason: "incompatible", message })
  })

  const step = Effect.fn("OpenCodeSync.step")(function* (input: { readonly deadline?: number } = {}) {
    if (yield* options.restoring) return { drained: false }
    if (!(yield* hasTables)) return { drained: true }
    const remote = yield* sync["sync.checkpoints"]().pipe(
      Effect.mapError(
        (error) =>
          new SyncError({ reason: "unavailable", message: `Ren did not return the checkpoints: ${error.message}` }),
      ),
    )
    const checkpoints = new Map(remote.sessions.map((checkpoint) => [checkpoint.id, checkpoint]))
    const local = yield* read((query) => [
      ...query(
        "select s.id, s.parent_id, s.time_suspended, e.seq from session_v2 s join event_sequence e on e.aggregate_id = s.id order by s.time_created, s.id",
      ),
    ]).pipe(Effect.flatMap((rows) => decode(Schema.Array(Local), rows)))
    const parents = new Map(local.map((session) => [session.id, session.parent_id]))
    const depth = (id: Session.ID): number => {
      const parent = parents.get(id)
      return parent && parents.has(parent) ? depth(parent) + 1 : 0
    }
    const pending = local
      .filter((session) => {
        const checkpoint = checkpoints.get(session.id)
        return (
          !refused.has(session.id) &&
          (!checkpoint || checkpoint.syncSeq !== session.seq || checkpoint.timeSuspended !== session.time_suspended)
        )
      })
      .toSorted((left, right) => depth(left.id) - depth(right.id))
    const outcomes = yield* Effect.forEach(pending, (session) =>
      Effect.gen(function* () {
        if (session.parent_id && refused.has(session.parent_id)) {
          refused.add(session.id)
          return "refused" as const
        }
        const now = yield* Clock.currentTimeMillis
        if (now >= (input.deadline ?? Number.POSITIVE_INFINITY)) return "late" as const
        const checkpoint = checkpoints.get(session.id)
        const until = (lastPass.get(session.id) ?? Number.NEGATIVE_INFINITY) + Duration.toMillis(busyInterval)
        if (session.time_suspended && checkpoint?.timeSuspended && now < until) return until
        const outcome = yield* pass(session, Boolean(checkpoint)).pipe(
          Effect.catch((error) =>
            Effect.logWarning("The sync pass stopped. The next step starts a new upload.", error).pipe(
              Effect.as("failed" as const),
            ),
          ),
          Effect.annotateLogs({ sessionId: session.id }),
        )
        if (outcome === "committed") lastPass.set(session.id, now)
        return outcome
      }),
    )
    if (outcomes.includes("failed")) return { drained: false, failed: true }
    if (outcomes.includes("late")) return { drained: false }
    const held = outcomes.filter((outcome) => typeof outcome === "number")
    return held.length === 0 ? { drained: true } : { drained: false, throttledUntil: Math.min(...held) }
  })

  const opened: Interface = {
    step: (input) => running.withPermit(step(input)),
    exclusive: (effect) => running.withPermit(effect),
  }
  return opened
})
