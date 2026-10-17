import { afterAll, expect } from "bun:test"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { Machine, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, DateTime, Effect, Fiber, Layer, Option, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Cell } from "../src/cell.js"
import { Env } from "../src/env.js"
import { HostAccess } from "../src/host-access.js"
import { HostToken } from "../src/host-token.js"
import { ModelStore } from "../src/model-store.js"
import { ModelsTest } from "./lib/models.js"
import { FakeRen } from "./lib/ren.js"
import { Shared } from "./lib/shared.js"

const ren = FakeRen.start()
afterAll(() => ren.stop())

const it = testEffect(Layer.empty)

const environmentId = Environment.ID.create()

const accessFor = (sessionId: Session.ID) =>
  Machine.access({
    url: "http://127.0.0.1:9",
    environmentId,
    brain: Brain.ofSession(sessionId),
    directory: Environment.sessionDirectory(sessionId),
    lifetimeMs: 900_000,
  })

const build = Effect.fnUntraced(function* (url: string = ren.url) {
  const sessionId = Session.ID.create()
  const vars = Schema.decodeUnknownSync(Env.Vars)({ ...Shared.vars(Shared.stub().url), REN_URL: url })
  const context = yield* Layer.build(
    HostAccess.layer(url).pipe(
      Layer.provideMerge(HostToken.layer(url, vars.CELL_KEYS)),
      Layer.provideMerge(ModelsTest.storage()),
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
    access: Context.get(context, EnvironmentAccess.Service),
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
    expect([opened.directory, opened.url, opened.generation, DateTime.toEpochMillis(opened.expiresAt)]).toEqual([
      access.directory,
      access.url,
      access.generation,
      DateTime.toEpochMillis(access.expiresAt),
    ])
    expect(ren.calls.filter((call) => call.sessionId === subject.sessionId)).toEqual([
      { endpoint: "environments.access", sessionId: subject.sessionId, hostToken, status: 200 },
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
    expect([error._tag, error.message]).toEqual(["EnvironmentAccess.Unavailable", "the cell has no valid host token"])
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
    expect(error._tag).toBe("EnvironmentAccess.Unavailable")
    expect(yield* subject.store.readHostToken).toEqual(Option.none())
  }),
)

it.live("Ren's no access is NotFound, and a sandbox Ren cannot give is unavailable with Ren's cause", () =>
  Effect.gen(function* () {
    const subject = yield* build()
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    ren.answer(subject.sessionId, () => ({ type: "not_found" }))
    expect((yield* subject.access.open(subject.sessionId).pipe(Effect.flip))._tag).toBe("EnvironmentAccess.NotFound")
    ren.answer(subject.sessionId, () => ({ type: "unavailable", message: "Every sandbox of env_1 is full" }))
    const full = yield* subject.access.open(subject.sessionId).pipe(Effect.flip)
    expect([full._tag, full.message]).toEqual(["EnvironmentAccess.Unavailable", "Every sandbox of env_1 is full"])
  }),
)

it.live("a refused connection to Ren fails at once and is not NotFound", () =>
  Effect.gen(function* () {
    const relay = yield* Relay.make(Relay.portOf(ren.url))
    yield* relay.refuse(true)
    const subject = yield* build(relay.url)
    yield* subject.configure(yield* Effect.promise(() => FakeRen.hostToken(subject.sessionId)))
    expect((yield* subject.access.open(subject.sessionId).pipe(Effect.flip))._tag).toBe("EnvironmentAccess.Unavailable")
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
    expect((yield* Fiber.join(opening))._tag).toBe("EnvironmentAccess.Unavailable")
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
      ["environments.access", false],
    ])
    expect(Option.getOrUndefined(yield* subject.store.readHostToken)).toBe(calls.at(1)?.hostToken)
  }),
)
