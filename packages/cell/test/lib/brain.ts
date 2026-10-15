export * as BrainTest from "./brain.js"

import { AbsolutePath, OpenCode } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { BrainApi } from "@ren/brain-api/brain-api"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Context, DateTime, Effect, FiberHandle, Layer, Option, Ref, Schema, Semaphore } from "effect"
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
import { Host } from "../../src/harness/opencode/host.js"
import { ModelStore } from "../../src/model-store.js"
import { Shared } from "./shared.js"

const make = Effect.gen(function* () {
  const vars = Schema.decodeUnknownSync(Env.Vars)(Shared.vars(Shared.stub().url))
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "ren-brain-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )
  const host = yield* Host.make(
    createEmbeddedRoutes({
      database: { path: ":memory:" },
      config: { project: false, content: vars.OPENCODE_CONFIG },
      models: { fetch: false },
      fs: { filewatcher: false, fff: false },
    }).pipe(Layer.provide(HttpServer.layerServices)),
    [],
    () => Effect.succeedNone,
  )
  const requests: Array<string> = []
  const transport: { before: (request: Request) => Effect.Effect<void>; sending: Effect.Effect<void> } = {
    before: () => Effect.void,
    sending: Effect.void,
  }
  const harness = yield* OpenCodeHarness.make(
    {
      ...host,
      fetch: (request) => {
        requests.push(new URL(request.url).pathname)
        return Effect.runPromise(transport.before(request)).then(() => host.fetch(request))
      },
    },
    [],
    AbsolutePath.make(directory),
  )
  const id = Session.ID.create()
  const alarm: { at: number | null } = { at: null }
  const stored = new Map<string, string>()
  const storage = {
    get: (key: string) => Promise.resolve(stored.get(key)),
    put: (key: string, value: string) => Promise.resolve(void stored.set(key, value)),
    delete: (key: string) => Promise.resolve(stored.delete(key)),
  }
  const modelStore = ModelStore.layer.pipe(Layer.provideMerge(Layer.succeed(ModelStore.Storage, storage)))
  yield* ModelStore.Service.pipe(
    Effect.flatMap((store) => store.write(Shared.access(undefined, Shared.stub().url), undefined)),
    Effect.provide(modelStore),
  )
  const info = Layer.succeed(
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
  )
  const activity = Layer.effect(
    Cell.Activity,
    Effect.all({
      requests: Ref.make(0),
      wait: FiberHandle.make<void>(),
      waitingSince: Ref.make(Option.none<DateTime.Utc>()),
      configuring: Semaphore.make(1),
    }),
  )
  const client = yield* HttpApiTest.groups(BrainApi, ["brain"]).pipe(
    Effect.provide(
      Brain.handlers.pipe(
        Layer.provide(
          Layer.mergeAll(
            info,
            activity,
            modelStore,
            Harness.layer(
              Effect.succeed({
                ...harness,
                send: (input) => transport.sending.pipe(Effect.andThen(harness.send(input))),
              }),
            ),
          ),
        ),
      ),
    ),
    Effect.provide(HttpServer.layerServices),
  )
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
  const models = (apiKeys?: Readonly<Record<string, Models.ApiKey>>) =>
    client.brain["brain.models"]({ payload: { access: Shared.access(apiKeys, Shared.stub().url) } })
  return {
    id,
    directory,
    stored,
    models,
    removeModels: client.brain["brain.removeModels"](),
    requests,
    transport,
    client,
    opencode,
    credentials: host.credentials,
    start: (input: Partial<Session.StartInput> = {}) =>
      client.brain["brain.start"]({
        payload: {
          sessionId: id,
          harness: "opencode",
          instructions: {},
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

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@ren/cell/test/Brain") {}

export const layer = Layer.effect(Service, make)
