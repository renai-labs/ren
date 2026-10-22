import { Database } from "bun:sqlite"
import type { OpenCodeSync } from "@ren/brain/opencode-sync"
import { Deferred, Duration, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Scope, Stream } from "effect"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import manifest from "../package.json"
import { Brain } from "./brain.js"
import { BrainKeys } from "./brain-keys.js"
import { BrainStorage } from "./brain-storage.js"
import { Cell } from "./cell.js"
import { Chat } from "./chat.js"
import { ChatSettings } from "./chat-settings.js"
import { Entry } from "./entry.js"
import { Env } from "./env.js"
import { Fence } from "./fence.js"
import { Harness } from "./harness/harness.js"
import { OpenCodeHarness } from "./harness/opencode/harness.js"
import { HotReload } from "./hot-reload.js"
import { Reconcile } from "./reconcile.js"
import { Scheduler } from "./scheduler.js"
import { Sync } from "./sync.js"

const vars = Schema.decodeUnknownSync(Env.Vars)(process.env)
const brainId = vars.REN_BRAIN_ID
if (!brainId) throw new Error("REN_BRAIN_ID is not set")
const home = process.env.REN_HOME ?? "/home/user"
const port = Number(process.env.PORT ?? "4800")
const state = join(home, ".ren")
const workspace = join(home, "workspace")
mkdirSync(state, { recursive: true })
mkdirSync(workspace, { recursive: true })
process.chdir(workspace)

const database = new Database(join(state, "brain.db"), { create: true })
database.run("pragma journal_mode = wal")
database.run("create table if not exists kv (key text primary key, value text not null)")
const select = database.query<{ value: string }, [string]>("select value from kv where key = ?")
const upsert = database.query(
  "insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
)
const remove = database.query("delete from kv where key = ?")

const storage = BrainStorage.Service.of({
  get: (key) => Promise.resolve(select.get(key)?.value),
  put: (key, value) => Promise.resolve(void upsert.run(key, value)),
  delete: (key) => Promise.resolve(remove.run(key)),
})

const harnessDatabase = join(state, "opencode.db")

const reader = Effect.sync((): OpenCodeSync.Reader => {
  const opened: { database: Database | undefined } = { database: undefined }
  return {
    read: (read) => {
      opened.database ??= new Database(harnessDatabase, { readonly: true })
      const connection = opened.database
      return connection.transaction(() => read((sql, ...bindings) => connection.query(sql).iterate(...bindings)))()
    },
  }
})

const info = Layer.succeed(
  Cell.Info,
  Cell.Info.of({
    storage: { getAlarm: () => Promise.resolve(null), setAlarm: () => Promise.resolve() },
    brainId,
    generation: vars.REN_BRAIN_GENERATION,
    version: manifest.version,
    vars,
  }),
)

const base = Layer.mergeAll(Cell.activityLayer, Cell.hostLayer).pipe(
  Layer.provideMerge(Layer.succeed(BrainStorage.Service, storage)),
  Layer.provideMerge(info),
)

const runtime = ManagedRuntime.make(
  Layer.mergeAll(Brain.layer, Chat.layer, Scheduler.layer).pipe(
    Layer.provideMerge(HotReload.layer),
    Layer.provideMerge(OpenCodeHarness.layerProcess(harnessDatabase, workspace)),
    Layer.provideMerge(Sync.layerWith(reader, vars.REN_URL)),
    Layer.provideMerge(Layer.mergeAll(ChatSettings.layer, BrainKeys.layer)),
    Layer.provideMerge(base),
  ),
)

const gate = { open: false }

const boot = Effect.gen(function* () {
  const harness = yield* Harness.Service
  const scheduler = yield* Scheduler.Service
  const hotReload = yield* HotReload.Service
  const sync = yield* Sync.Service
  const fence = yield* Fence.Service
  const scope = yield* Scope.make()
  const opened = yield* harness.get.pipe(Scope.provide(scope))
  yield* opened.onTurn({
    started: () => scheduler.trigger("pull"),
    ended: () => Effect.all([scheduler.trigger("pull"), scheduler.trigger("sync")], { discard: true }),
  })
  gate.open = true
  yield* Effect.logInfo(`Brain ${brainId} generation ${vars.REN_BRAIN_GENERATION} is ready on port ${port}`)
  const interval = Duration.millis(vars.PULL_INTERVAL_MS)
  yield* scheduler
    .job(
      "sync",
      sync.step.pipe(
        Effect.map(Option.match({ onNone: () => interval, onSome: (next) => Duration.min(next, interval) })),
      ),
    )
    .pipe(Scope.provide(scope))
  yield* scheduler.job("pull", hotReload.pull.pipe(Effect.as(interval))).pipe(Scope.provide(scope))
  yield* scheduler
    .job(
      "reconcile",
      Effect.gen(function* () {
        const sessions = yield* opened.sessions
        yield* Effect.forEach(
          sessions,
          (session) => {
            const work = Reconcile.work(session, vars.PARK_AFTER_MS)
            if (work._tag === "Unanswered") return session.interrupt
            if (work._tag === "Queued") return session.resend(work.item.id)
            return Effect.void
          },
          { discard: true },
        )
        return Duration.millis(vars.ALARM_INTERVAL_MS)
      }),
    )
    .pipe(Scope.provide(scope))
  yield* opened.chat.events.pipe(
    Stream.filter((event) => event.type.startsWith("session.")),
    Stream.debounce("1 second"),
    Stream.runForEach(() => scheduler.trigger("sync")),
    Effect.catchCause((cause) => Effect.logWarning("The event watch for sync stopped", cause)),
    Effect.forkIn(scope),
  )
  yield* Deferred.await(fence.retired).pipe(
    Effect.flatMap(() =>
      Effect.gen(function* () {
        gate.open = false
        const sessions = yield* opened.sessions
        yield* Effect.forEach(sessions, (session) => (session.active ? session.interrupt : Effect.void), {
          discard: true,
        })
        yield* Scope.close(scope, Exit.void)
      }),
    ),
    Effect.forkDetach,
  )
})

const handle = (request: Request): Promise<Response> => {
  const pathname = new URL(request.url).pathname
  const isChat = Chat.owns(pathname)
  if (isChat && request.method === "OPTIONS")
    return Promise.resolve(new Response(null, { status: 204, headers: Entry.cors }))
  if (!gate.open)
    return Promise.resolve(
      Response.json(
        { _tag: "UnavailableError", message: "The brain is not ready" },
        { status: 503, headers: Entry.cors },
      ),
    )
  return runtime
    .runPromise(
      Effect.gen(function* () {
        const keys = yield* BrainKeys.Service
        const checked = yield* Entry.check(request, {
          keys: keys.current,
          brain: Option.some(brainId),
          generation: vars.REN_BRAIN_GENERATION,
        })
        if (checked instanceof Response) return checked
        return yield* Cell.fetch(checked.request)
      }),
    )
    .then((response) => (isChat ? Entry.withCors(response) : response))
}

const server = Bun.serve({ port, hostname: "0.0.0.0", idleTimeout: 0, fetch: handle })

process.on("SIGTERM", () => {
  gate.open = false
  void runtime
    .runPromise(
      Effect.gen(function* () {
        const sync = yield* Sync.Service
        yield* sync.flush.pipe(Effect.timeout("8 seconds"), Effect.ignore)
      }),
    )
    .finally(() => {
      void server.stop()
      process.exit(0)
    })
})

runtime
  .runPromise(boot.pipe(Effect.tapCause((cause) => Effect.logError("The brain failed to boot", cause))))
  .catch(() => process.exit(1))
