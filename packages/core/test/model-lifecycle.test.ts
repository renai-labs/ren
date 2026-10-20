import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { Brain } from "@ren/schema/brain"
import { SessionToken } from "@ren/host-api/session-token"
import { Shared, TestCell, TestToken, Wrangler } from "@ren/cell/testing"
import type { Celld } from "@ren/cell/testing"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Effect, Layer, Redacted, Schedule, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { BrainHost } from "../src/brain-host.js"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"
import { RenHostApiTest } from "./lib/ren-host-api.js"
import { Host } from "./lib/host.js"

setDefaultTimeout(180_000)

const stub = Shared.stub()
const organizationId = Auth.OrganizationID.create()
const active = TestToken.keys[0]
const rotated = TestToken.keys[1]
const minuteMs = 60_000
const hourMs = 60 * minuteMs

const access = (apiKeys: Parameters<typeof Shared.access>[0], baseUrl = stub.url) => Shared.access(apiKeys, baseUrl)
const lasting = (value: string) => Shared.apiKey(value)
const expiring = (value: string, inMs: number) => Shared.apiKey(value, Date.now() + inMs)

const source: { access: Models.Access; available: boolean } = {
  access: access({ stub: lasting("sk-initial") }),
  available: true,
}

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () =>
      source.available
        ? Effect.sync(() => source.access)
        : Effect.fail(new Models.Unavailable({ cause: new Error("the model source is down") })),
    refreshIfDue: () => Effect.succeedNone,
    revoke: () => Effect.void,
  }),
)

const keysOf = (keys: ReadonlyArray<SessionToken.Key>) => JSON.stringify(keys)

const brainHost = (cellUrl: string, keys: ReadonlyArray<SessionToken.Key>) =>
  Host.layer({ CELL_URL: cellUrl, CELL_KEYS: keysOf(keys) }, models)

const corePort = await (async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = Number(probe.url.port)
  await probe.stop(true)
  return port
})()

const core: {
  running: boolean
  stop: () => Promise<void>
  refreshes: number
  gate: { arrived: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> } | undefined
} = { running: false, stop: () => Promise.resolve(), refreshes: 0, gate: undefined }

const startCore = (keys: ReadonlyArray<SessionToken.Key>) => {
  const api = HttpRouter.toWebHandler(
    RenHostApiTest.layer((endpoint, effect) =>
      endpoint !== "models.refresh"
        ? effect
        : Effect.gen(function* () {
            core.refreshes += 1
            const gate = core.gate
            if (gate) {
              gate.arrived.resolve()
              yield* Effect.promise(() => gate.release.promise)
            }
            return yield* effect
          }),
    ).pipe(Layer.provide(brainHost(cell.url, keys)), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )
  const server = Bun.serve({ hostname: "127.0.0.1", port: corePort, fetch: (request) => api.handler(request) })
  core.running = true
  core.stop = async () => {
    await server.stop(true)
    await api.dispose()
  }
}

const stopCore = async () => {
  await core.stop()
  core.stop = () => Promise.resolve()
  core.running = false
}

let cell: Celld.Instance
beforeAll(async () => {
  cell = await Wrangler.make({ ...Shared.vars(stub.url), REN_URL: `http://127.0.0.1:${corePort}` })
  startCore([active])
}, 180_000)
afterAll(async () => {
  await stopCore()
  await cell.dispose()
  await Shared.dispose()
})

const it = testEffect(Layer.empty)

const HostState = Schema.Struct({ isOpen: Schema.Boolean, holders: Schema.Number })

const Outcome = Schema.Struct({ data: Schema.Struct({ outcome: Schema.optional(Schema.String) }) })

const withHost = <A, E>(keys: ReadonlyArray<SessionToken.Key>, effect: Effect.Effect<A, E, BrainHost.Service>) =>
  effect.pipe(Effect.provide(brainHost(cell.url, keys)))

const start = (
  sessionId: Session.ID,
  input: Partial<Session.StartInput> = {},
  keys: ReadonlyArray<SessionToken.Key> = [active],
) =>
  withHost(
    keys,
    BrainHost.Service.use((brain) =>
      brain.start(
        { sessionId, harness: "opencode", instructions: {}, interactive: true, ...input },
        { organizationId, spaceId: Space.ID.create() },
      ),
    ),
  )

const send = (sessionId: Session.ID, text: string, keys: ReadonlyArray<SessionToken.Key> = [active]) =>
  withHost(
    keys,
    BrainHost.Service.use((brain) =>
      brain.send(
        {
          sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text },
          delivery: "steer",
          sender: { userId: "user_1" },
        },
        organizationId,
      ),
    ),
  )

const authorization = (sessionId: Session.ID, scope: "server" | "client") =>
  Effect.promise(() => TestCell.sign({ sid: sessionId, scope }).then((token) => TestToken.basic(token)))

const put = (sessionId: Session.ID, granted: Models.Access, presented?: string) =>
  Effect.gen(function* () {
    const header = yield* authorization(sessionId, "server")
    const hostToken = presented ?? (yield* signHost(sessionId, Date.now() + hourMs))
    const response = yield* Effect.promise(() =>
      fetch(`${cell.url}/ren/models`, {
        method: "PUT",
        headers: { authorization: header, "content-type": "application/json" },
        body: JSON.stringify(
          Schema.encodeSync(Schema.toCodecJson(Brain.ModelGrant))({
            access: granted,
            ...(hostToken && { hostToken: Redacted.make(hostToken) }),
          }),
        ),
      }),
    )
    expect(response.status).toBe(204)
  })

const signHost = (sessionId: Session.ID, expMs: number, key: SessionToken.Key = active) =>
  SessionToken.sign(key, {
    sid: sessionId,
    scope: "host",
    org: organizationId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expMs / 1000),
  })

const state = (sessionId: Session.ID) =>
  Effect.gen(function* () {
    const header = yield* authorization(sessionId, "server")
    const response = yield* Effect.promise(() => fetch(`${cell.url}/ren/state`, { headers: { authorization: header } }))
    return Schema.decodeUnknownSync(HostState)(yield* Effect.promise(() => response.json()))
  })

const until = (sessionId: Session.ID, predicate: (current: typeof HostState.Type) => boolean) =>
  state(sessionId).pipe(
    Effect.repeat({ until: predicate, schedule: Schedule.spaced("25 millis") }),
    Effect.timeout("60 seconds"),
  )

const asleep = (sessionId: Session.ID) => until(sessionId, (current) => !current.isOpen && current.holders === 0)

const client = (sessionId: Session.ID, path: string, method = "GET") =>
  Effect.gen(function* () {
    const header = yield* authorization(sessionId, "client")
    return yield* Effect.promise(() => fetch(`${cell.url}${path}`, { method, headers: { authorization: header } }))
  })

const settled = (sessionId: Session.ID) =>
  Effect.gen(function* () {
    yield* client(sessionId, `/api/experimental/session/${sessionId}/wait`, "POST")
    const response = yield* client(sessionId, `/api/session/${sessionId}`)
    return Schema.decodeUnknownSync(Outcome)(yield* Effect.promise(() => response.json())).data.outcome
  })

const afterExpiry = (expiresAtMs: number) =>
  Effect.suspend(() => Effect.sleep(Math.max(0, expiresAtMs - Date.now() + 500)))

const ready = (sessionId: Session.ID, initial: Models.Access) =>
  Effect.gen(function* () {
    source.access = initial
    yield* start(sessionId)
    const opened = stub.script()
    yield* send(sessionId, `open ${opened.marker}`)
    yield* Effect.promise(() => opened.called())
    yield* settled(sessionId)
    yield* asleep(sessionId)
    return opened
  })

describe("E. core's updates in each cell lifecycle state", () => {
  it.live("E1 key: a new key pushed while the cell sleeps leaves it asleep and reaches the next model call", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      yield* ready(sessionId, access({ stub: lasting("sk-e1-old") }))
      yield* put(sessionId, access({ stub: lasting("sk-e1-new") }))
      expect((yield* state(sessionId)).isOpen).toBe(false)
      const script = stub.script()
      yield* send(sessionId, `after ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-e1-new")
    }),
  )

  it.live("E1 add: an endpoint pushed while the cell sleeps can be chosen when it wakes", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      yield* ready(sessionId, access({ stub: lasting("sk-e1") }))
      yield* put(sessionId, access({ stub: lasting("sk-e1"), later: lasting("sk-later") }))
      expect((yield* state(sessionId)).isOpen).toBe(false)
      yield* start(sessionId, { model: { endpointId: "later", modelId: "stub-model" } })
      const script = stub.script()
      yield* send(sessionId, `later ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-later")
    }),
  )

  it.live("E1 remove: an endpoint removed while the cell sleeps is refused when it wakes", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      yield* ready(sessionId, access({ stub: lasting("sk-e1"), later: lasting("sk-later") }))
      yield* put(sessionId, access({ stub: lasting("sk-e1") }))
      const refused = yield* start(sessionId, { model: { endpointId: "later", modelId: "stub-model" } }).pipe(
        Effect.flip,
      )
      expect(refused._tag).toBe("BrainRejectedError")
    }),
  )

  it.live("E1 base URL: a base URL and key pushed while the cell sleeps reach the next model call together", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      source.access = access({ later: lasting("sk-e1") })
      yield* start(sessionId, { model: { endpointId: "later", modelId: "stub-model" } })
      const opened = stub.script()
      yield* send(sessionId, `open ${opened.marker}`)
      yield* settled(sessionId)
      yield* asleep(sessionId)
      yield* put(sessionId, access({ later: lasting("sk-moved") }, stub.url.replace(/\/v1$/u, "/moved/v1")))
      const script = stub.script()
      yield* send(sessionId, `moved ${script.marker}`)
      const call = yield* Effect.promise(() => script.called())
      expect([call.path, call.authorization]).toEqual(["/moved/v1/chat/completions", "Bearer sk-moved"])
    }),
  )

  it.live("E3: an update pushed while the harness is opening reaches the next model call", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      yield* ready(sessionId, access({ stub: lasting("sk-e3-old") }))
      const opening = { done: false }
      const header = yield* authorization(sessionId, "client")
      const opened = fetch(`${cell.url}/api/info`, { headers: { authorization: header } }).then(() => {
        opening.done = true
      })
      yield* until(sessionId, (current) => current.isOpen)
      const pushedWhileOpening = !opening.done
      yield* put(sessionId, access({ stub: lasting("sk-e3-new") }))
      yield* Effect.promise(() => opened)
      expect(pushedWhileOpening).toBe(true)
      const script = stub.script()
      yield* send(sessionId, `opened ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-e3-new")
    }),
  )

  it.live("E4: an update pushed as the harness closes reaches the model call that reopens it", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      source.access = access({ stub: lasting("sk-e4-old") })
      yield* start(sessionId)
      const opened = stub.script()
      yield* send(sessionId, `open ${opened.marker}`)
      yield* settled(sessionId)
      yield* until(sessionId, (current) => !current.isOpen)
      yield* put(sessionId, access({ stub: lasting("sk-e4-new") }))
      const script = stub.script()
      yield* send(sessionId, `reopened ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-e4-new")
    }),
  )

  it.live("E5a: an endpoint removed during a turn on it lets the turn finish, then is refused", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      source.access = access({ stub: lasting("sk-e5"), later: lasting("sk-later") })
      yield* start(sessionId, { model: { endpointId: "later", modelId: "stub-model" } })
      const script = stub.script({ hold: true })
      yield* send(sessionId, `running ${script.marker}`)
      yield* Effect.promise(() => script.called())
      yield* put(sessionId, access({ stub: lasting("sk-e5") }))
      script.release()
      expect([yield* settled(sessionId), script.calls.length]).toEqual(["succeeded", 1])
      const refused = yield* start(sessionId, { model: { endpointId: "later", modelId: "stub-model" } }).pipe(
        Effect.flip,
      )
      expect(refused._tag).toBe("BrainRejectedError")
    }),
  )
})

describe("F. keys and host tokens across sleep, restart and outages", () => {
  it.live("F1: a key that expired while the cell slept is granted anew on the next send", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const expiresAt = Date.now() + 3000
      source.access = access({ stub: Shared.apiKey("sk-f1-short", expiresAt) })
      yield* start(sessionId)
      yield* asleep(sessionId)
      source.access = access({ stub: lasting("sk-f1-long") })
      yield* afterExpiry(expiresAt)
      const script = stub.script()
      yield* send(sessionId, `expired ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-f1-long")
    }),
  )

  it.live("F2: a key that entered its refresh window while the cell slept is refreshed by the cell on wake", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const expiresAt = Date.now() + 5 * minuteMs + 4000
      yield* ready(sessionId, access({ stub: Shared.apiKey("sk-f2-old", expiresAt) }))
      source.access = access({ stub: expiring("sk-f2-new", hourMs) })
      yield* afterExpiry(expiresAt - 5 * minuteMs)
      const refreshes = core.refreshes
      const script = stub.script()
      yield* send(sessionId, `window ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-f2-new")
      expect(core.refreshes - refreshes).toBeGreaterThanOrEqual(1)
    }),
  )

  it.live("F3: a rejected host token keeps the valid key in use, and an expired key is granted anew", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const expiresAt = Date.now() + 4000
      const short = access({ stub: Shared.apiKey("sk-f3-short", expiresAt) })
      source.access = short
      yield* start(sessionId)
      yield* put(sessionId, short, yield* signHost(sessionId, Date.now() - minuteMs))
      const first = stub.script()
      yield* send(sessionId, `kept ${first.marker}`)
      expect((yield* Effect.promise(() => first.called())).authorization).toBe("Bearer sk-f3-short")
      yield* settled(sessionId)
      source.access = access({ stub: lasting("sk-f3-granted") })
      yield* afterExpiry(expiresAt)
      const second = stub.script()
      yield* send(sessionId, `granted ${second.marker}`)
      expect((yield* Effect.promise(() => second.called())).authorization).toBe("Bearer sk-f3-granted")
    }),
  )

  it.live("F4: a turn resumed after a crash refreshes a key that expired while the cell was down", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const expiresAt = Date.now() + 4000
      source.access = access({ stub: Shared.apiKey("sk-f4-short", expiresAt) })
      yield* start(sessionId)
      const script = stub.script({ hold: true, reply: "cut off" })
      yield* send(sessionId, `crash ${script.marker}`)
      yield* Effect.promise(() => script.called())
      yield* Effect.promise(() => cell.kill())
      source.access = access({ stub: expiring("sk-f4-new", hourMs) })
      script.set({ reply: "resumed" })
      yield* afterExpiry(expiresAt)
      yield* Effect.promise(() => cell.start())
      const resumed = yield* Effect.promise(() => script.called(2)).pipe(Effect.timeout("60 seconds"))
      expect(resumed.authorization).toBe("Bearer sk-f4-new")
      expect(yield* settled(sessionId)).toBe("succeeded")
    }),
  )

  it.live("F5: with the model source down an expired key fails as BrainUnavailable, then recovers", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const expiresAt = Date.now() + 4000
      source.access = access({ stub: Shared.apiKey("sk-f5-short", expiresAt) })
      yield* start(sessionId)
      yield* asleep(sessionId)
      source.available = false
      yield* Effect.promise(stopCore)
      yield* afterExpiry(expiresAt)
      const failure = yield* send(sessionId, "while down").pipe(Effect.flip)
      expect(failure._tag).toBe("BrainUnavailable")
      source.available = true
      source.access = access({ stub: lasting("sk-f5-back") })
      startCore([active])
      const script = stub.script()
      yield* send(sessionId, `back ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-f5-back")
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          source.available = true
          if (!core.running) startCore([active])
        }),
      ),
    ),
  )

  it.live("F6: a refresh in flight when the cell dies leaves usable access after restart", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      source.access = access({ stub: expiring("sk-f6-window", 2 * minuteMs) })
      yield* start(sessionId)
      const gate = { arrived: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
      core.gate = gate
      const script = stub.script()
      yield* send(sessionId, `inflight ${script.marker}`)
      yield* Effect.promise(() => gate.arrived.promise)
      yield* Effect.promise(() => cell.kill())
      source.access = access({ stub: expiring("sk-f6-new", hourMs) })
      gate.release.resolve()
      core.gate = undefined
      yield* Effect.promise(() => cell.start())
      expect(yield* settled(sessionId).pipe(Effect.timeout("60 seconds"))).toBe("succeeded")
      expect(["Bearer sk-f6-window", "Bearer sk-f6-new"]).toContain(script.calls.at(-1)?.authorization ?? "")
    }).pipe(Effect.ensuring(Effect.sync(() => (core.gate = undefined)))),
  )
})

describe("G. core restarts and signing-key rotation", () => {
  it.live("G1: a core restart between grant and refresh does not stop the cell refreshing", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      source.access = access({ stub: expiring("sk-g1-window", 2 * minuteMs) })
      yield* start(sessionId)
      yield* Effect.promise(stopCore)
      startCore([active])
      source.access = access({ stub: expiring("sk-g1-new", hourMs) })
      const script = stub.script()
      yield* send(sessionId, `restarted ${script.marker}`)
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-g1-new")
    }),
  )

  it.live("G2 overlap: a host token signed with the retiring key still refreshes while that key is listed", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      source.access = access({ stub: expiring("sk-g2-window", 2 * minuteMs) })
      yield* start(sessionId)
      yield* Effect.promise(stopCore)
      startCore([rotated, active])
      source.access = access({ stub: expiring("sk-g2-new", hourMs) })
      const script = stub.script()
      yield* send(sessionId, `rotating ${script.marker}`, [rotated, active])
      expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-g2-new")
    }).pipe(Effect.ensuring(Effect.promise(stopCore).pipe(Effect.andThen(Effect.sync(() => startCore([active])))))),
  )

  it.live("G2 removed: a token signed with a removed key keeps the valid key; the expired key is granted anew", () =>
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const expiresAt = Date.now() + 5000
      source.access = access({ stub: Shared.apiKey("sk-g2-short", expiresAt) })
      yield* start(sessionId)
      yield* Effect.promise(stopCore)
      startCore([rotated])
      const first = stub.script()
      yield* send(sessionId, `kept ${first.marker}`, [rotated])
      expect((yield* Effect.promise(() => first.called())).authorization).toBe("Bearer sk-g2-short")
      yield* settled(sessionId)
      source.access = access({ stub: lasting("sk-g2-granted") })
      yield* afterExpiry(expiresAt)
      const second = stub.script()
      yield* send(sessionId, `granted ${second.marker}`, [rotated])
      expect((yield* Effect.promise(() => second.called())).authorization).toBe("Bearer sk-g2-granted")
    }).pipe(Effect.ensuring(Effect.promise(stopCore).pipe(Effect.andThen(Effect.sync(() => startCore([active])))))),
  )
})
