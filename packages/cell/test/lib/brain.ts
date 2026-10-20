export * as BrainTest from "./brain.js"

import { AbsolutePath, OpenCode } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { BrainApi } from "@ren/host-api/brain-api"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Context, DateTime, Effect, FiberHandle, Layer, Option, Queue, Redacted, Ref, Schema, Semaphore } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FetchHttpClient, HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"
import { Brain } from "../../src/brain.js"
import { Cell } from "../../src/cell.js"
import { Env } from "../../src/env.js"
import { Harness } from "../../src/harness/harness.js"
import { OpenCodeHarness } from "../../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../../src/harness/opencode/server.js"
import { HostToken } from "../../src/host-token.js"
import { ModelRefresh } from "../../src/model-refresh.js"
import { ModelStore } from "../../src/model-store.js"
import { Sync } from "../../src/sync.js"
import { ModelsTest } from "./models.js"
import { Shared } from "./shared.js"
import { TestToken } from "./token.js"

export const make = Effect.fnUntraced(function* (
  options: { readonly database?: string; readonly id?: Session.ID } = {},
) {
  const vars = Schema.decodeUnknownSync(Env.Vars)(Shared.vars(Shared.stub().url))
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-brain-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const issuer = yield* ModelsTest.issuer
  const id = options.id ?? Session.ID.create()
  const alarm: { at: number | null } = { at: null }
  const services = yield* Layer.build(
    Layer.mergeAll(
      ModelRefresh.layer(issuer.url).pipe(
        Layer.provideMerge(HostToken.layer(issuer.url, TestToken.keys)),
        Layer.provide(FetchHttpClient.layer),
      ),
      Layer.succeed(
        Cell.Info,
        Cell.Info.of({
          sessionId: id,
          vars,
          storage: {
            getAlarm: () => Promise.resolve(alarm.at),
            setAlarm: (at: number | Date) => {
              alarm.at = Number(at)
              return Promise.resolve()
            },
          },
        }),
      ),
      Layer.effect(
        Cell.Activity,
        Effect.all({
          requests: Ref.make(0),
          wait: FiberHandle.make<void>(),
          waitingSince: Ref.make(Option.none<DateTime.Utc>()),
          configuring: Semaphore.make(1),
          closedIdle: Ref.make(false),
        }),
      ),
      Layer.effect(Sync.Service, Sync.make(Option.none())),
    ).pipe(Layer.provideMerge(ModelsTest.storage())),
  )
  yield* Context.get(services, ModelStore.Service).write(Shared.access(undefined, Shared.stub().url), undefined)
  const host = yield* OpenCodeServer.make(
    createEmbeddedRoutes({
      database: { path: options.database ?? ":memory:" },
      config: { project: false, content: vars.OPENCODE_CONFIG },
      models: { fetch: false },
      fs: { filewatcher: false, fff: false },
    }).pipe(Layer.provide(HttpServer.layerServices)),
    [],
    Context.get(services, ModelRefresh.Service),
    Option.none(),
  )
  const harness = yield* OpenCodeHarness.make(host, [], AbsolutePath.make(directory))
  const waits = yield* Queue.unbounded<number>()
  const cell = Context.merge(
    services,
    yield* Layer.build(
      Harness.layer(
        Effect.succeed({
          ...harness,
          sessions: harness.sessions.pipe(
            Effect.map((sessions) =>
              sessions.map((session) => ({
                ...session,
                wait: (ms: number) => Queue.offer(waits, ms).pipe(Effect.andThen(session.wait(ms))),
              })),
            ),
          ),
        }),
      ),
    ),
  )
  const client = yield* HttpApiTest.groups(BrainApi, ["brain"]).pipe(
    Effect.provide(Brain.handlers.pipe(Layer.provide(Layer.succeedContext(cell)))),
    Effect.provide(HttpServer.layerServices),
  )
  const web = Context.get(yield* Layer.build(Brain.layer.pipe(Layer.provide(Layer.succeedContext(cell)))), Cell.Brain)
  const opencode = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          host.fetch(new Request(input instanceof Request ? input.url : String(input), init)),
        { preconnect: fetch.preconnect },
      ),
    ),
  )
  return {
    id,
    directory,
    issuer,
    configureModels: (apiKeys?: Readonly<Record<string, Models.ApiKey>>, hostToken?: string) =>
      client.brain["brain.configureModels"]({
        payload: {
          access: Shared.access(apiKeys, Shared.stub().url),
          ...(hostToken && { hostToken: Redacted.make(hostToken) }),
        },
      }),
    removeModels: client.brain["brain.removeModels"](),
    state: client.brain["brain.state"](),
    alarm: Effect.sync(() => {
      alarm.at = null
    }).pipe(Effect.andThen(Cell.alarm()), Effect.provide(cell)),
    waited: Queue.take(waits),
    client,
    fetch: (path: string, init?: RequestInit) =>
      Effect.promise(() => web.fetch(new Request(`http://cell${path}`, init))),
    store: Context.get(services, ModelStore.Service),
    opencode,
    credentials: host.credentials,
    start: (input: Partial<Session.StartInput> = {}) =>
      client.brain["brain.start"]({
        payload: {
          sessionId: id,
          harness: "opencode",
          interactive: true,
          ...input,
        },
      }),
    send: (text: string, input: Partial<Omit<Session.SendInput, "sessionId">> = {}) =>
      client.brain["brain.send"]({
        params: { id },
        payload: {
          messageId: Session.MessageID.create(),
          prompt: { text },
          delivery: "steer",
          sender: { userId: "user_1" },
          ...input,
        },
      }),
  }
})

export class Service extends Context.Service<Service, Effect.Success<ReturnType<typeof make>>>()(
  "@ren/cell/test/Brain",
) {}

export const layer = Layer.effect(Service, make())
