export * as BrainRuns from "./brain-runs.js"

import { BrainProvider } from "../../src/brain-provider.js"
import { Shared } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import type { Machine } from "@ren/schema/machine"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { type Duration, Effect, Layer, ManagedRuntime, Schedule, Schema, Tracer } from "effect"
import type { HttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Models } from "../../src/models.js"
import { Host } from "./host.js"
import { Seed } from "./seed.js"

export const stub = Shared.stub()

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    revision: Effect.succeed("test"),
    catalog: () => Effect.sync(() => Models.catalog(Shared.access({ stub: Shared.apiKey("sk-lifecycle") }, stub.url))),
    providers: Effect.sync(() =>
      Models.registrations(Models.catalog(Shared.access({ stub: Shared.apiKey("sk-lifecycle") }, stub.url))),
    ),
    grant: () => Effect.sync(() => Shared.access({ stub: Shared.apiKey("sk-lifecycle") }, stub.url)),
  }),
)

export const isAlive = (pid: number) => Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0

export const pidOf = (binding: unknown) => Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Int }))(binding).pid

export const brainOf = (binding: unknown) =>
  Number(
    new TextDecoder()
      .decode(Bun.spawnSync(["pgrep", "-g", String(pidOf(binding)), "-f", "^bun .*cell/src/bun\\.ts"]).stdout)
      .trim()
      .split("\n")[0],
  )

// oxlint-disable-next-line ren/no-comments -- One file's Postgres, Ren port and brain root. Each ren() is a Ren that starts and stops on that root; when it stops it kills every brain under the root, unless keepBrains leaves them for the next Ren of the test.
export const make = async () => {
  const database = ManagedRuntime.make(Testing.layer)
  const port = await Effect.runPromise(Host.freePort)
  const root = await mkdtemp(join(tmpdir(), "ren-core-brains-"))

  const ren = async (
    options: {
      readonly lostEvery?: Duration.Input
      readonly maxRunning?: number
      readonly root?: string
      readonly systemImage?: string
      readonly port?: number
      readonly around?: Parameters<typeof Host.serve>[1]
      readonly config?: Record<string, string>
      readonly sandbox?: Layer.Layer<BrainProvider.Registry, unknown, HttpClient.HttpClient>
      readonly keepBrains?: boolean
      readonly tracer?: Tracer.Tracer
    } = {},
  ) =>
    ManagedRuntime.make(
      Host.serve(options.port ?? port, options.around).pipe(
        Layer.provideMerge(
          Host.stack({
            root,
            config: options.config ?? {},
            models,
            environments: Host.noTemplates,
            ...options,
            port: options.port ?? port,
          }),
        ),
        Layer.provide(
          Layer.succeedContext(await database.runPromise(Effect.context<Database.Service | SqlClient.SqlClient>())),
        ),
        Layer.provide(options.tracer ? Layer.succeed(Tracer.Tracer, options.tracer) : Layer.empty),
      ),
    )

  const row = (brainId: Brain.ID) =>
    database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        const found = (yield* db.db
          .select()
          .from(Database.Schema.brain)
          .where(eq(Database.Schema.brain.id, brainId))).at(0)
        if (!found) return yield* Effect.die(new Error(`Brain ${brainId} does not exist`))
        return found
      }),
    )

  const seeded = () =>
    database.runPromise(
      Effect.gen(function* () {
        const organizationId = yield* Seed.organization()
        const spaceId = yield* Seed.space(organizationId)
        const creator = yield* Seed.user()
        const brainId = Brain.ID.create()
        const sessionId = yield* Seed.session({ organizationId, spaceId, createdBy: creator.id, brainId })
        yield* Seed.join(spaceId, creator.id)
        return { brainId, sessionId, spaceId, organizationId, creatorId: creator.id }
      }),
    )

  return {
    database,
    root,
    ren,
    row,
    seeded,
    newBrain: () => seeded().then((found) => found.brainId),
    reaches: (brainId: Brain.ID, phase: Machine.Phase, options: { readonly generation?: number } = {}) =>
      Effect.runPromise(
        Effect.promise(() => row(brainId)).pipe(
          Effect.repeat({
            until: (found) =>
              found.phase === phase && (options.generation === undefined || found.generation === options.generation),
            schedule: Schedule.spaced("100 millis"),
          }),
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () => Effect.die(new Error(`Brain ${brainId} did not reach ${phase}`)),
          }),
        ),
      ),
    replaced: (brainId: Brain.ID) =>
      Effect.runPromise(
        Effect.promise(() => row(brainId)).pipe(
          Effect.repeat({
            until: (found) => found.phase === "ready" && found.generation > 1,
            schedule: Schedule.spaced("100 millis"),
          }),
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () => Effect.die(new Error(`Brain ${brainId} did not get a new sandbox`)),
          }),
        ),
      ),
    update: (brainId: Brain.ID, values: Partial<typeof Database.Schema.brain.$inferInsert>) =>
      database.runPromise(
        Effect.gen(function* () {
          const db = yield* Database.Service
          yield* db.db.update(Database.Schema.brain).set(values).where(eq(Database.Schema.brain.id, brainId))
        }),
      ),
    busy: (sessionId: Session.ID) =>
      database.runPromise(
        Effect.gen(function* () {
          const db = yield* Database.Service
          yield* db.db.insert(Database.Schema.opencode_session).values({
            session_id: sessionId,
            project_id: "global",
            slug: "busy",
            directory: "/home/user/workspace",
            version: "2",
            cost: 0,
            tokens_input: 0,
            tokens_output: 0,
            tokens_reasoning: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            time_created: Date.now(),
            time_updated: Date.now(),
            time_suspended: Date.now(),
          })
        }),
      ),
    // oxlint-disable-next-line ren/no-comments -- An idle chat whose inbox holds only the notice a restore leaves with resume: false.
    notice: (sessionId: Session.ID) =>
      database.runPromise(
        Effect.gen(function* () {
          const db = yield* Database.Service
          yield* db.db.insert(Database.Schema.opencode_session).values({
            session_id: sessionId,
            project_id: "global",
            slug: "idle",
            directory: "/home/user/workspace",
            version: "2",
            cost: 0,
            tokens_input: 0,
            tokens_output: 0,
            tokens_reasoning: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          yield* db.db.insert(Database.Schema.opencode_inbox).values({
            id: Session.MessageID.create(),
            session_id: sessionId,
            type: "synthetic",
            payload: JSON.stringify({
              text: "This chat moved to a new machine.",
              metadata: { source: "ren.files-reset" },
            }),
            delivery: "steer",
            enqueued_seq: 1,
            time_created: Date.now(),
          })
        }),
      ),
    mark: (sessionId: Session.ID) =>
      database.runPromise(
        Effect.gen(function* () {
          const db = yield* Database.Service
          return (
            (yield* db.db
              .select({ next: Database.Schema.agent_session.continue_message_id })
              .from(Database.Schema.agent_session)
              .where(eq(Database.Schema.agent_session.id, sessionId))).at(0)?.next ?? null
          )
        }),
      ),
    marked: (sessionId: Session.ID) =>
      database.runPromise(
        Effect.gen(function* () {
          const db = yield* Database.Service
          yield* db.db
            .update(Database.Schema.agent_session)
            .set({ continue_message_id: Session.MessageID.create() })
            .where(eq(Database.Schema.agent_session.id, sessionId))
        }),
      ),
    outcome: (sessionId: Session.ID) =>
      database.runPromise(
        Effect.gen(function* () {
          const db = yield* Database.Service
          return (yield* db.db
            .select({ outcome: Database.Schema.opencode_session.idle_outcome })
            .from(Database.Schema.opencode_session)
            .where(eq(Database.Schema.opencode_session.session_id, sessionId))).at(0)?.outcome
        }),
      ),
    archive: (table: "session" | "space", found: { readonly sessionId: Session.ID; readonly spaceId: Space.ID }) =>
      database.runPromise(
        Effect.gen(function* () {
          const db = yield* Database.Service
          if (table === "session")
            yield* db.db
              .update(Database.Schema.agent_session)
              .set({ archived_at: new Date() })
              .where(eq(Database.Schema.agent_session.id, found.sessionId))
          else
            yield* db.db
              .update(Database.Schema.space)
              .set({ archived_at: new Date() })
              .where(eq(Database.Schema.space.id, found.spaceId))
        }),
      ),
    setup: () => database.runPromise(Seed.ren()),
    dispose: async () => {
      const last = await ren()
      await last.runPromise(Effect.void)
      await last.dispose()
      await database.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
