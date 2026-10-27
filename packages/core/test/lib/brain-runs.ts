export * as BrainRuns from "./brain-runs.js"

import { Shared } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { type Duration, Effect, Layer, ManagedRuntime, Schedule, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Models } from "../../src/models.js"
import type { SandboxProvider } from "../../src/sandbox-provider.js"
import { Host } from "./host.js"
import { Seed } from "./seed.js"

export const stub = Shared.stub()

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    inference: Shared.inference(),
    revision: Effect.succeed("test"),
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () => Effect.sync(() => Shared.access({ stub: Shared.apiKey("sk-lifecycle") }, stub.url)),
  }),
)

export const isAlive = (pid: number) => Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0

export const pidOf = (binding: unknown) => Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Int }))(binding).pid

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
      readonly template?: string
      readonly port?: number
      readonly around?: Parameters<typeof Host.serve>[1]
      readonly config?: Record<string, string>
      readonly sandbox?: Layer.Layer<SandboxProvider.Service, unknown, HttpClient.HttpClient>
      readonly keepBrains?: boolean
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
    ren,
    row,
    seeded,
    newBrain: () => seeded().then((found) => found.brainId),
    reaches: (brainId: Brain.ID, phase: Brain.Phase) =>
      Effect.runPromise(
        Effect.promise(() => row(brainId)).pipe(
          Effect.repeat({ until: (found) => found.phase === phase, schedule: Schedule.spaced("100 millis") }),
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () => Effect.die(new Error(`Brain ${brainId} did not reach ${phase}`)),
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
