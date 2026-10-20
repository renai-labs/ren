import { afterAll, expect } from "bun:test"
import { EnvironmentFiles } from "@opencode/core/environment/files"
import { HandAccess } from "@ren/brain/hand-access"
import { HandConnections } from "@ren/brain/hand-connections"
import { TestHand, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { Context, DateTime, Effect, Fiber, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Cell } from "../src/cell.js"
import { Env } from "../src/env.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"
import { HostAccess } from "../src/host-access.js"
import { HostToken } from "../src/host-token.js"
import { ModelStore } from "../src/model-store.js"
import { ModelsTest } from "./lib/models.js"
import { FakeRen } from "./lib/ren.js"
import { Shared } from "./lib/shared.js"

const ren = FakeRen.start()
afterAll(() => ren.stop())

const it = testEffect(Layer.empty)

const handId = Hand.ID.create()

const accessFor = (sessionId: Session.ID) =>
  TestHand.access({
    url: "http://127.0.0.1:9",
    handId,
    brain: Brain.ofSession(sessionId),
    directory: `/workspace/${sessionId}`,
    lifetimeMs: 900_000,
  })

const build = Effect.fnUntraced(function* (url: string = ren.url, stored = new Map<string, string>()) {
  const sessionId = Session.ID.create()
  const vars = Schema.decodeUnknownSync(Env.Vars)({ ...Shared.vars(Shared.stub().url), REN_URL: url })
  const context = yield* Layer.build(
    HostAccess.layer.pipe(
      Layer.provideMerge(HostToken.layer(url, vars.CELL_KEYS)),
      Layer.provide(FetchHttpClient.layer),
      Layer.provideMerge(ModelsTest.storage(stored)),
      Layer.provideMerge(
        Layer.succeed(
          Cell.Info,
          Cell.Info.of({
            sessionId,
            vars,
            storage: { getAlarm: () => Promise.resolve(null), setAlarm: () => Promise.resolve() },
          }),
        ),
      ),
    ),
  )
  const store = Context.get(context, ModelStore.Service)
  return {
    sessionId,
    store,
    hostToken: Context.get(context, HostToken.Service),
    access: Context.get(context, HandAccess.Service),
    configure: (hostToken: string) => store.write(Shared.access(undefined, Shared.stub().url), hostToken),
  }
})

it.live("asks Ren once for the session of its host token and gives the access Ren names", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    const access = yield* accessFor(subject.sessionId)
    ren.answer(subject.sessionId, () => ({ type: "access", access }))
    const hostToken = yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId))
    yield* subject.configure(hostToken)
    const opened = yield* subject.access.open(subject.sessionId)
    expect([opened.directory, opened.url.href, opened.generation, DateTime.toEpochMillis(opened.expiresAt)]).toEqual([
      access.directory,
      access.url.href,
      access.generation,
      DateTime.toEpochMillis(access.expiresAt),
    ])
    expect(ren.calls.filter((call) => call.sessionId === subject.sessionId)).toEqual([
      { endpoint: "hands.access", sessionId: subject.sessionId, hostToken, status: 200 },
    ])
  }),
)

it.live("uses the host token that a later model configuration stored", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    ren.answer(subject.sessionId, () => ({ type: "not_found" }))
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    yield* subject.access.open(subject.sessionId).pipe(Effect.ignore)
    const newer = yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId, 7200))
    yield* subject.configure(newer)
    yield* subject.access.open(subject.sessionId).pipe(Effect.ignore)
    expect(ren.calls.findLast((call) => call.sessionId === subject.sessionId)?.hostToken).toBe(newer)
  }),
)

it.live("without a host token it fails at once as Ren does not answer, and asks nothing", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    const error = yield* subject.access.open(subject.sessionId).pipe(Effect.flip)
    expect([error._tag, error.message]).toEqual(["HandAccess.Unavailable", "the cell has no valid host token"])
    expect(ren.accessCalls(subject.sessionId)).toBe(0)
  }),
)

it.live("a host token that Ren refuses is not a revoke: it is Ren does not answer, and the token is dropped", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    ren.refuseHosts(true)
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    const error = yield* subject.access
      .open(subject.sessionId)
      .pipe(Effect.flip, Effect.ensuring(Effect.sync(() => ren.refuseHosts(false))))
    expect(error._tag).toBe("HandAccess.Unavailable")
    expect(yield* subject.store.readHostToken).toEqual(Option.none())
  }),
)

it.live("Ren's no access is NotFound, and a sandbox Ren cannot give is unavailable with Ren's cause", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    ren.answer(subject.sessionId, () => ({ type: "not_found" }))
    expect((yield* subject.access.open(subject.sessionId).pipe(Effect.flip))._tag).toBe("HandAccess.NotFound")
    ren.answer(subject.sessionId, () => ({ type: "unavailable", message: "Every sandbox of env_1 is full" }))
    const full = yield* subject.access.open(subject.sessionId).pipe(Effect.flip)
    expect([full._tag, full.message]).toEqual(["HandAccess.Unavailable", "Every sandbox of env_1 is full"])
  }),
)

it.live("a refused connection to Ren fails at once and is not NotFound", () =>
  Effect.gen(function* () {
    const relay = yield* Relay.make(Relay.portOf(ren.url))
    yield* relay.refuse(true)
    const subject = yield* build(relay.url)
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    expect((yield* subject.access.open(subject.sessionId).pipe(Effect.flip))._tag).toBe("HandAccess.Unavailable")
  }),
)

it.effect("a Ren that accepts the request and never answers fails the access in 10 seconds", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    ren.answer(subject.sessionId, () => ({ type: "hold" }))
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    const opening = yield* subject.access.open(subject.sessionId).pipe(Effect.flip, Effect.forkScoped)
    yield* Effect.promise(() => ren.reached(subject.sessionId))
    yield* TestClock.adjust(HostToken.renAnswersWithin)
    expect((yield* Fiber.join(opening))._tag).toBe("HandAccess.Unavailable")
  }),
)

it.live("a host token in its last five minutes is renewed through host.refresh, without the model flow", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    const access = yield* accessFor(subject.sessionId)
    ren.answer(subject.sessionId, () => ({ type: "access", access }))
    const expiring = yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId, 120))
    yield* subject.configure(expiring)
    yield* subject.access.open(subject.sessionId)
    const calls = ren.calls.filter((call) => call.sessionId === subject.sessionId)
    expect(calls.map((call) => [call.endpoint, call.hostToken === expiring])).toEqual([
      ["host.refresh", true],
      ["hands.access", false],
    ])
    expect(Option.getOrUndefined(yield* subject.store.readHostToken)).toBe(calls.at(1)?.hostToken)
  }),
)

it.live("removing the models removes the host token, so the access fails at once and asks Ren nothing", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    yield* subject.store.remove
    const error = yield* subject.access.open(subject.sessionId).pipe(Effect.flip)
    expect([error._tag, error.message]).toEqual(["HandAccess.Unavailable", "the cell has no valid host token"])
    expect(ren.calls.filter((call) => call.sessionId === subject.sessionId)).toEqual([])
  }),
)

it.live("50 calls in the renewal window of the host token make one host.refresh and all use the new token", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    const access = yield* accessFor(subject.sessionId)
    ren.answer(subject.sessionId, () => ({ type: "access", access }))
    const expiring = yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId, 120))
    yield* subject.configure(expiring)
    const opened = yield* Effect.forEach(Array.from({ length: 50 }), () => subject.access.open(subject.sessionId), {
      concurrency: "unbounded",
    })
    const calls = ren.calls.filter((call) => call.sessionId === subject.sessionId)
    expect(opened).toHaveLength(50)
    expect(calls.filter((call) => call.endpoint === "host.refresh")).toHaveLength(1)
    const used = new Set(calls.filter((call) => call.endpoint === "hands.access").map((call) => call.hostToken))
    expect([used.size, used.has(expiring)]).toEqual([1, false])
  }),
)

it.live("a host token configured while the host token is being renewed wins, with no failure", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    const access = yield* accessFor(subject.sessionId)
    ren.answer(subject.sessionId, () => ({ type: "access", access }))
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId, 120)))
    const gate = Promise.withResolvers<void>()
    ren.holdRefresh(() => gate.promise)
    const opening = yield* subject.access.open(subject.sessionId).pipe(Effect.forkScoped)
    yield* Effect.promise(() => ren.reached(subject.sessionId))
    const newer = yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId, 7200))
    yield* subject.configure(newer)
    gate.resolve()
    yield* Fiber.join(opening).pipe(Effect.ensuring(Effect.sync(() => ren.holdRefresh(undefined))))
    expect(ren.calls.findLast((call) => call.endpoint === "hands.access")?.hostToken).toBe(newer)
    expect(yield* subject.store.readHostToken).toEqual(Option.some(newer))
  }),
)

it.live(
  "an expired host token fails the access with Ren's refusal and is dropped; a new configuration repairs it",
  () =>
    Effect.gen(function* () {
      const subject = yield* build()
      const access = yield* accessFor(subject.sessionId)
      ren.answer(subject.sessionId, () => ({ type: "access", access }))
      yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId, -60)))
      expect(yield* subject.hostToken.isValid).toBe(false)
      const error = yield* subject.access.open(subject.sessionId).pipe(Effect.flip)
      expect([error._tag, error.message]).toEqual([
        "HandAccess.Unavailable",
        expect.stringContaining("Ren refused the host token"),
      ])
      expect(yield* subject.store.readHostToken).toEqual(Option.none())
      yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
      expect([yield* subject.hostToken.isValid, (yield* subject.access.open(subject.sessionId)).url.href]).toEqual([
        true,
        access.url.href,
      ])
    }),
)

it.effect("20 file calls on a Ren that never answers all end in 10 seconds, on one Host API call", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    ren.answer(subject.sessionId, () => ({ type: "hold" }))
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    const environments = Context.get(
      yield* Layer.build(
        HandConnections.layer.pipe(
          Layer.provide(Layer.succeed(HandAccess.Service, subject.access)),
          Layer.provide(FetchHttpClient.layer),
        ),
      ),
      HandConnections.Service,
    )
    const driver = RenWorkspaceDriver.session(environments, subject.sessionId)
    const calls = yield* Effect.forEach(
      Array.from({ length: 20 }),
      () => driver.overrides.stat(`/workspace/${subject.sessionId}/a.ts`).pipe(Effect.flip),
      { concurrency: "unbounded" },
    ).pipe(Effect.forkScoped)
    yield* Effect.promise(() => ren.reached(subject.sessionId))
    yield* TestClock.adjust(HostToken.renAnswersWithin)
    const errors = yield* Fiber.join(calls)
    expect(
      errors.filter(
        (error) => error instanceof EnvironmentFiles.Failed && String(error.cause).includes("Ren does not answer"),
      ),
    ).toHaveLength(20)
    expect(ren.accessCalls(subject.sessionId)).toBe(1)
  }),
)

it.live("the cell's own storage holds only the models and the host token, never a binding", () =>
  Effect.gen(function* () {
    const stored = new Map<string, string>()
    const subject = yield* build(ren.url, stored)
    const access = yield* accessFor(subject.sessionId)
    ren.answer(subject.sessionId, () => ({ type: "access", access }))
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId, 120)))
    yield* subject.access.open(subject.sessionId)
    expect([...stored.keys()].toSorted()).toEqual(["ren:host-token", "ren:models"])
    expect([...stored.values()].filter((value) => value.includes(Redacted.value(access.token)))).toEqual([])
  }),
)
