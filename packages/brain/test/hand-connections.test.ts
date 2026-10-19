import { expect } from "bun:test"
import { TestAccess } from "./lib/access.js"
import type { Hello } from "@ren/hand-api/executor-api"
import { Executor } from "@ren/executor/executor"
import { Machine } from "@ren/executor/machine"
import { ExecutorClient } from "@ren/hand-api/executor-client"
import { Sandbox, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import {
  Cause,
  Clock,
  Context,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Redacted,
  Ref,
  Stream,
} from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { TestClock } from "effect/testing"
import { mkdtemp, realpath, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HandConnections } from "../src/hand-connections.js"
import { HandAccess } from "../src/hand-access.js"
import { Hand } from "../src/hand.js"
import { Probe } from "./lib/probe.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-")))
const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-elsewhere-")))
await writeFile(join(workspace, "which"), workspace)
await writeFile(join(elsewhere, "which"), elsewhere)
const it = testEffect(Sandbox.layer({ environmentId, workspace }))

const which = (connection: HandConnections.Connection) =>
  connection.client["files.read"]({ path: "which" }).pipe(
    Effect.orDie,
    Effect.map((result) => new TextDecoder().decode(result.bytes)),
  )

const sessionId = Session.ID.create()
const brain = Brain.ofSession(sessionId)
const folder = (root = workspace) => join(root, sessionId)

const accessAt = (
  url: string,
  options: {
    readonly issuedAt?: number
    readonly lifetimeMs?: number
    readonly root?: string
    readonly generation?: number
  } = {},
) =>
  Sandbox.access({
    url,
    environmentId,
    brain,
    directory: folder(options.root),
    ...(options.issuedAt !== undefined && { issuedAt: options.issuedAt }),
    ...(options.lifetimeMs !== undefined && { lifetimeMs: options.lifetimeMs }),
    ...(options.generation !== undefined && { generation: options.generation }),
  })

const environmentsWith = (
  access: Layer.Layer<HandAccess.Service>,
  http: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer,
) =>
  Layer.build(HandConnections.layer.pipe(Layer.provide(access), Layer.provide(http))).pipe(
    Effect.map((context) => Context.get(context, HandConnections.Service)),
  )

const opening = (open: HandAccess.Interface["open"]) =>
  Layer.succeed(HandAccess.Service, HandAccess.Service.of({ open }))

const machine = (options: Parameters<typeof Sandbox.layer>[0]) =>
  Layer.build(Layer.fresh(Sandbox.layer(options))).pipe(
    Effect.flatMap((context) => Effect.provide(Sandbox.url, context)),
  )

const renDown = (id: Session.ID) => new HandAccess.Unavailable({ sessionId: id, message: "connection refused" })

const noAccess = (id: Session.ID) => new HandAccess.NotFound({ sessionId: id, message: "no binding" })

const connect = (environments: HandConnections.Interface) => environments.connect(sessionId)

const build = (options: { readonly failures: number; readonly gate?: Deferred.Deferred<void> }) =>
  Effect.gen(function* () {
    const access = yield* accessAt(yield* Sandbox.url)
    const opens = yield* Ref.make(0)
    const requests = yield* Ref.make(0)
    const http = Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        HttpClient.mapRequestEffect(client, (request) =>
          Ref.update(requests, (count) => count + 1).pipe(Effect.as(request)),
        ),
      ),
    ).pipe(Layer.provide(FetchHttpClient.layer))
    const host = opening(() =>
      Effect.gen(function* () {
        if (options.gate) yield* Deferred.await(options.gate)
        const count = yield* Ref.getAndUpdate(opens, (value) => value + 1)
        return count < options.failures ? { ...access, token: Redacted.make("invalid") } : access
      }),
    )
    const environments = yield* Layer.build(HandConnections.layer.pipe(Layer.provide(host), Layer.provide(http))).pipe(
      Effect.map((context) => Context.get(context, HandConnections.Service)),
    )
    return { environments, opens, requests }
  })

it.live("concurrent failing connects share one failure and one renewal", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>()
    const subject = yield* build({ failures: 2, gate })
    const [exits] = yield* Effect.all(
      [
        Effect.all(
          Array.from({ length: 10 }, () => Effect.exit(connect(subject.environments))),
          { concurrency: "unbounded" },
        ),
        Deferred.succeed(gate, undefined),
      ],
      { concurrency: "unbounded" },
    )
    const errors = exits.map((exit) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined))
    expect(errors[0]).toBeInstanceOf(HandConnections.Unavailable)
    expect(new Set(errors).size).toBe(1)
    expect(yield* Ref.get(subject.opens)).toBe(2)
    expect(yield* Ref.get(subject.requests)).toBe(2)
  }),
)

it.live(
  "a failed lookup is not cached, the next connect retries, and the first contact makes the session's folder",
  () =>
    Effect.gen(function* () {
      const subject = yield* build({ failures: 4 })
      expect((yield* Effect.flip(connect(subject.environments))).reason).toBe("token_refused")
      expect((yield* Effect.flip(connect(subject.environments))).reason).toBe("token_refused")
      const connection = yield* connect(subject.environments)
      expect(connection.hello.environmentId).toBe(environmentId)
      expect((yield* Effect.promise(() => stat(folder()))).isDirectory()).toBe(true)
      expect(yield* Ref.get(subject.opens)).toBe(5)
      expect(yield* connect(subject.environments)).toBe(connection)
      expect(yield* Ref.get(subject.opens)).toBe(5)
    }),
)

it.live("a session without access fails with no access", () =>
  Effect.gen(function* () {
    const environments = yield* environmentsWith(TestAccess.fixed(new Map()))
    const error = yield* connect(environments).pipe(Effect.flip)
    expect([error.reason, error.message]).toEqual([
      "no_access",
      `No access to a hand: Session ${sessionId} has no access to an environment`,
    ])
  }),
)

it.live("an executor that serves another environment refuses the token, and the call fails with token refused", () =>
  Effect.gen(function* () {
    const access = yield* Sandbox.access({
      url: yield* Sandbox.url,
      environmentId: Environment.ID.create(),
      brain,
      directory: folder(),
    })
    const environments = yield* environmentsWith(TestAccess.fixed(new Map([[sessionId, access]])))
    expect((yield* connect(environments).pipe(Effect.flip)).reason).toBe("token_refused")
  }),
)

it.live("a session folder that is a file on the sandbox fails the first contact with its cause", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-folder-file-"))))
    yield* Effect.promise(() => writeFile(join(root, sessionId), "not a folder"))
    const url = yield* machine({ environmentId, workspace: root })
    const environments = yield* environmentsWith(
      TestAccess.fixed(new Map([[sessionId, yield* accessAt(url, { root })]])),
    )
    const error = yield* connect(environments).pipe(Effect.flip)
    expect(error.reason).toBe("unusable")
    expect(error.message).toContain(`Could not make the directory ${join(root, sessionId)} on the hand`)
  }),
)

it.effect("refreshes a token in its last five minutes, once for many concurrent calls, and keeps the connection", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 900_000 })),
        ),
      ),
    )
    const connection = yield* connect(environments)
    yield* TestClock.adjust(Duration.seconds(9 * 60 + 59))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(1)
    yield* TestClock.adjust(Duration.seconds(2))
    yield* Effect.all(
      Array.from({ length: 10 }, () => connection.client["executor.hello"]()),
      { concurrency: "unbounded" },
    )
    expect(yield* Ref.get(opens)).toBe(2)
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
    expect(yield* connect(environments)).toBe(connection)
  }),
)

it.effect("a 20-second token refreshes in its last third, not on every call", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 20_000 })),
        ),
      ),
    )
    const connection = yield* connect(environments)
    yield* Effect.forEach([1, 2, 3], () => connection.client["executor.hello"](), { discard: true })
    expect(yield* Ref.get(opens)).toBe(1)
    yield* TestClock.adjust(Duration.seconds(14))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.effect("keeps using a token it could not refresh while Ren does not answer, and asks Ren once in 30 seconds", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening((id) =>
        Ref.getAndUpdate(opens, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 0
              ? Clock.currentTimeMillis.pipe(
                  Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 600_000 })),
                )
              : Effect.fail(renDown(id)),
          ),
        ),
      ),
    )
    const connection = yield* connect(environments)
    yield* TestClock.adjust(Duration.minutes(7))
    yield* Effect.forEach(Array.from({ length: 100 }), () => connection.client["executor.hello"](), { discard: true })
    expect(yield* Ref.get(opens)).toBe(2)
    yield* TestClock.adjust(Duration.seconds(29))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
    yield* TestClock.adjust(Duration.seconds(2))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(3)
    expect(yield* connect(environments)).toBe(connection)
  }),
)

it.effect(
  "fails clearly once a token expires while Ren is down, and works again on the first try after the backoff",
  () =>
    Effect.gen(function* () {
      const url = yield* Sandbox.url
      const isDown = yield* Ref.make(false)
      const environments = yield* environmentsWith(
        opening((id) =>
          Effect.gen(function* () {
            if (yield* Ref.get(isDown)) return yield* renDown(id)
            return yield* accessAt(url, { issuedAt: yield* Clock.currentTimeMillis, lifetimeMs: 600_000 })
          }),
        ),
      )
      yield* connect(environments)
      yield* Ref.set(isDown, true)
      yield* TestClock.adjust(Duration.minutes(11))
      const error = yield* connect(environments).pipe(Effect.flip)
      expect([error.reason, error.message]).toEqual(["ren_unavailable", "Ren does not answer: connection refused"])
      yield* Ref.set(isDown, false)
      expect((yield* connect(environments).pipe(Effect.flip)).reason).toBe("ren_unavailable")
      yield* TestClock.adjust(Duration.seconds(31))
      expect((yield* connect(environments)).hello.environmentId).toBe(environmentId)
    }),
)

it.effect(
  "a refresh that Ren answers with no access closes the connection at once, and the next call has no access",
  () =>
    Effect.gen(function* () {
      const url = yield* Sandbox.url
      const opens = yield* Ref.make(0)
      const environments = yield* environmentsWith(
        opening((id) =>
          Ref.getAndUpdate(opens, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 0
                ? Clock.currentTimeMillis.pipe(
                    Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 600_000 })),
                  )
                : Effect.fail(noAccess(id)),
            ),
          ),
        ),
      )
      const connection = yield* connect(environments)
      yield* TestClock.adjust(Duration.minutes(7))
      yield* connection.client["executor.hello"]()
      const error = yield* connect(environments).pipe(Effect.flip)
      expect([error.reason, error.message]).toEqual(["no_access", "No access to a hand: no binding"])
    }),
)

it.live(
  "a sandbox that does not answer fails the call once, and the next call asks Ren and reaches the new sandbox",
  () =>
    Effect.gen(function* () {
      const relay = yield* Relay.make(Relay.portOf(yield* Sandbox.url))
      const second = yield* machine({ environmentId, workspace: elsewhere })
      const current = yield* Ref.make(yield* accessAt(relay.url))
      const opens = yield* Ref.make(0)
      const environments = yield* environmentsWith(
        opening(() => Ref.update(opens, (count) => count + 1).pipe(Effect.andThen(Ref.get(current)))),
      )
      const connection = yield* connect(environments)
      yield* relay.refuse(true)
      yield* relay.cut
      yield* Ref.set(current, yield* accessAt(second, { root: elsewhere, generation: 2 }))
      const failed = yield* connection.client["process.spawn"]({ command: "true", arguments: [] }).pipe(Effect.flip)
      expect(ExecutorClient.isNoAnswer(failed)).toBe(true)
      expect(yield* Ref.get(opens)).toBe(1)
      const next = yield* connect(environments)
      expect([yield* which(next), yield* Ref.get(opens)]).toEqual([elsewhere, 2])
    }),
)

const statArrived = Effect.runSync(Deferred.make<void>())

const frozen = Layer.effect(
  Executor.Service,
  Effect.map(Executor.Service, (executor) =>
    Executor.Service.of({
      ...executor,
      stat: () => Deferred.succeed(statArrived, undefined).pipe(Effect.andThen(Effect.never)),
    }),
  ),
).pipe(Layer.provide(Machine.layer))

it.effect("a call to a sandbox that accepts the request and never answers ends in its time limit", () =>
  Effect.gen(function* () {
    const url = yield* machine({ environmentId, workspace, executor: frozen })
    const opens = yield* Ref.make(0)
    const access = yield* accessAt(url, { lifetimeMs: 3_600_000 })
    const environments = yield* environmentsWith(
      opening(() => Ref.update(opens, (count) => count + 1).pipe(Effect.as(access))),
    )
    const connection = yield* connect(environments)
    const call = yield* connection.client["files.stat"]({ path: folder() }).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(statArrived)
    yield* TestClock.adjust(ExecutorClient.answerWithin)
    const error = yield* Fiber.join(call)
    expect(error.message).toContain("The hand did not answer files.stat within 30s")
    yield* connect(environments)
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.live("keeps a connection when only its token changes", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const first = yield* accessAt(url)
    const context = yield* Layer.build(TestAccess.memory(new Map([[sessionId, first]])))
    const memory = Context.get(context, TestAccess.Memory)
    const environments = yield* environmentsWith(Layer.succeedContext(context))
    const kept = yield* Effect.scoped(connect(environments))
    yield* memory.set(sessionId, yield* accessAt(url, { lifetimeMs: 900_000 }))
    expect(yield* Effect.scoped(connect(environments))).toBe(kept)
  }),
)

const controlled = Effect.fnUntraced(function* (initial: Effect.Success<ReturnType<HandAccess.Interface["open"]>>) {
  const current = yield* Ref.make(initial)
  const gate = yield* Ref.make(
    Option.none<{ readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }>(),
  )
  const environments = yield* environmentsWith(
    Layer.succeed(
      HandAccess.Service,
      HandAccess.Service.of({
        open: () =>
          Effect.gen(function* () {
            const snapshot = yield* Ref.get(current)
            const held = yield* Ref.getAndSet(gate, Option.none())
            if (Option.isSome(held)) {
              yield* Deferred.succeed(held.value.entered, undefined)
              yield* Deferred.await(held.value.release)
            }
            return snapshot
          }),
      }),
    ),
  )
  return {
    current,
    environments,
    holdNextOpen: Effect.gen(function* () {
      const held = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
      yield* Ref.set(gate, Option.some(held))
      return held
    }),
  }
})

const where = (environments: HandConnections.Interface) => Effect.scoped(Effect.flatMap(connect(environments), which))

it.effect("moves to the new sandbox when a renewed access names a new address, with no change notice", () =>
  Effect.gen(function* () {
    const second = yield* machine({ environmentId, workspace: elsewhere })
    const subject = yield* controlled(yield* accessAt(yield* Sandbox.url, { issuedAt: yield* Clock.currentTimeMillis }))
    expect(yield* where(subject.environments)).toBe(workspace)
    yield* TestClock.adjust(Duration.minutes(7))
    yield* Ref.set(
      subject.current,
      yield* accessAt(second, { root: elsewhere, issuedAt: yield* Clock.currentTimeMillis }),
    )
    yield* where(subject.environments)
    expect(yield* where(subject.environments)).toBe(elsewhere)
  }),
)

const reporting = (hello: Partial<Pick<Hello, "protocol">>) =>
  Layer.effect(
    Executor.Service,
    Effect.map(Executor.Service, (executor) =>
      Executor.Service.of({
        ...executor,
        hello: {
          protocol: hello.protocol ?? executor.hello.protocol,
          version: executor.hello.version,
          environmentId: executor.hello.environmentId,
          os: executor.hello.os,
          arch: executor.hello.arch,
        },
      }),
    ),
  ).pipe(Layer.provide(Machine.layer))

it.live("refuses an executor that speaks another protocol", () =>
  Effect.gen(function* () {
    const environmentsFor = Effect.fnUntraced(function* (hello: Partial<Pick<Hello, "protocol">>) {
      const url = yield* machine({ environmentId, workspace, executor: reporting(hello) })
      return yield* environmentsWith(TestAccess.fixed(new Map([[sessionId, yield* accessAt(url)]])))
    })
    const newer = yield* Effect.scoped(connect(yield* environmentsFor({ protocol: 2 }))).pipe(Effect.flip)
    expect([newer.reason, newer.message]).toEqual([
      "incompatible",
      "The executor is not compatible: it speaks protocol 2, not 1",
    ])
  }),
)

it.live("gets a new access once when the executor refuses one the brain still thinks is valid, and does not loop", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const opens = yield* Ref.make(0)
    const refusedToken = (yield* Sandbox.access({
      url,
      environmentId: Environment.ID.create(),
      brain,
      directory: folder(),
    })).token
    const environments = yield* environmentsWith(
      opening(() =>
        Effect.gen(function* () {
          const access = yield* accessAt(url)
          const count = yield* Ref.getAndUpdate(opens, (value) => value + 1)
          return count === 1 ? access : { ...access, token: refusedToken }
        }),
      ),
    )
    const connection = yield* Effect.scoped(connect(environments))
    expect(connection.hello.environmentId).toBe(environmentId)
    expect(yield* Ref.get(opens)).toBe(2)
    const always = yield* Ref.make(0)
    const refusing = yield* environmentsWith(
      opening(() =>
        Ref.update(always, (count) => count + 1).pipe(
          Effect.andThen(accessAt(url)),
          Effect.map((access) => ({ ...access, token: refusedToken })),
        ),
      ),
    )
    const refused = yield* Effect.scoped(connect(refusing)).pipe(Effect.flip)
    expect([refused.reason, yield* Ref.get(always)]).toEqual(["token_refused", 2])
  }),
)

it.live("many first connects of one session share one lookup, one hello and one folder", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>()
    const subject = yield* build({ failures: 0, gate })
    const [connections] = yield* Effect.all(
      [
        Effect.all(
          Array.from({ length: 20 }, () => connect(subject.environments)),
          { concurrency: "unbounded" },
        ),
        Deferred.succeed(gate, undefined),
      ],
      { concurrency: "unbounded" },
    )
    expect(new Set(connections).size).toBe(1)
    expect(yield* Ref.get(subject.opens)).toBe(1)
    expect(yield* Ref.get(subject.requests)).toBe(2)
  }),
)

it.live("a session that has no access or a dead sandbox leaves the connection of another session", () =>
  Effect.gen(function* () {
    const relay = yield* Relay.make(Relay.portOf(yield* Sandbox.url))
    const dead = Session.ID.create()
    const missing = Session.ID.create()
    const accesses = new Map([
      [
        sessionId,
        yield* Sandbox.access({
          url: yield* Sandbox.url,
          environmentId,
          brain,
          directory: folder(),
        }),
      ],
      [
        dead,
        yield* Sandbox.access({
          url: relay.url,
          environmentId,
          brain: Brain.ofSession(dead),
          directory: join(workspace, dead),
        }),
      ],
    ])
    const asked = yield* Ref.make<ReadonlyArray<Session.ID>>([])
    const environments = yield* environmentsWith(
      opening((id) =>
        Ref.update(asked, (all) => [...all, id]).pipe(
          Effect.andThen(() => {
            const access = accesses.get(id)
            return access ? Effect.succeed(access) : Effect.fail(noAccess(id))
          }),
        ),
      ),
    )
    const kept = yield* connect(environments)
    const doomed = yield* environments.connect(dead)
    expect((yield* environments.connect(missing).pipe(Effect.flip)).reason).toBe("no_access")
    yield* relay.refuse(true)
    yield* relay.cut
    expect(
      ExecutorClient.isNoAnswer(yield* doomed.client["files.stat"]({ path: join(workspace, dead) }).pipe(Effect.flip)),
    ).toBe(true)
    expect((yield* environments.connect(dead).pipe(Effect.flip)).reason).toBe("unreachable")
    expect(yield* connect(environments)).toBe(kept)
    expect((yield* kept.client["executor.hello"]()).environmentId).toBe(environmentId)
    expect((yield* Ref.get(asked)).filter((id) => id === sessionId)).toHaveLength(1)
  }),
)

it.effect("a connection outlives its token and still reaches the processes it started", () =>
  Effect.gen(function* () {
    const sandbox = yield* Probe.make()
    const url = yield* Probe.start({ environmentId, workspace, executor: sandbox.layer })
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 600_000 })),
        ),
      ),
    )
    const connection = yield* environments.connect(sessionId)
    const handle = yield* Hand.spawner(connection, (signal) => new Error(`Killed by ${signal}`)).spawn(
      ChildProcess.make("cat", []),
    )
    yield* Probe.advance(Duration.minutes(11))
    expect(yield* Ref.get(opens)).toBeGreaterThan(1)
    expect(yield* environments.connect(sessionId)).toBe(connection)
    yield* Stream.make(new TextEncoder().encode("still here")).pipe(Stream.run(handle.stdin))
    expect(yield* Stream.decodeText(handle.stdout).pipe(Stream.mkString)).toBe("still here")
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

it.live("a command sent to a sandbox that then stops answering is started once at most, and never sent again", () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    const old = yield* Probe.make({
      afterSpawn: () => Deferred.succeed(arrived, undefined).pipe(Effect.andThen(Effect.never)),
    })
    const relay = yield* Relay.make(Relay.portOf(yield* Probe.start({ environmentId, workspace, executor: old.layer })))
    const access = yield* accessAt(relay.url)
    const environments = yield* environmentsWith(opening(() => Effect.succeed(access)))
    const connection = yield* connect(environments)
    const spawn = connection.client["process.spawn"]({ command: "true", arguments: [] })
    const sent = yield* Effect.forkScoped(Effect.flip(spawn))
    yield* Deferred.await(arrived)
    yield* relay.refuse(true)
    yield* relay.cut
    expect(ExecutorClient.isNoAnswer(yield* Fiber.join(sent))).toBe(true)
    yield* relay.refuse(false)
    const next = yield* connect(environments)
    expect(next).not.toBe(connection)
    yield* next.client["executor.hello"]()
    expect(yield* Ref.get(old.spawns)).toBe(1)
    yield* relay.refuse(true)
    yield* relay.cut
    expect(
      ExecutorClient.isNoAnswer(
        yield* next.client["process.spawn"]({ command: "true", arguments: [] }).pipe(Effect.flip),
      ),
    ).toBe(true)
    yield* relay.refuse(false)
    yield* connect(environments).pipe(Effect.flatMap((again) => again.client["executor.hello"]()))
    expect(yield* Ref.get(old.spawns)).toBe(1)
  }),
)

it.live(
  "an executor whose clock is 20 minutes ahead refuses the renewed token too, and the call fails with token refused",
  () =>
    Effect.gen(function* () {
      const url = yield* Sandbox.url
      const now = yield* Clock.currentTimeMillis
      const opens = yield* Ref.make(0)
      const ahead = yield* accessAt(url, { issuedAt: now - 20 * 60_000, lifetimeMs: 10 * 60_000 })
      const environments = yield* environmentsWith(
        opening(() =>
          Ref.update(opens, (count) => count + 1).pipe(
            Effect.as({ ...ahead, expiresAt: DateTime.makeUnsafe(now + 10 * 60_000) }),
          ),
        ),
      )
      const error = yield* Effect.scoped(connect(environments)).pipe(Effect.flip)
      expect([error.reason, yield* Ref.get(opens)]).toEqual(["token_refused", 2])
      expect(error.message).not.toContain(Redacted.value(ahead.token))
    }),
)

const skewed = Effect.fnUntraced(function* (url: string, issuedAt: number) {
  const access = yield* accessAt(url, { issuedAt, lifetimeMs: 60_000 })
  return { ...access, expiresAt: DateTime.makeUnsafe(issuedAt + 900_000) }
})

it.effect("10 calls that the executor refuses at the same time cause one renewal, and all succeed after it", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.getAndUpdate(opens, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((issuedAt) => (count === 0 ? skewed(url, issuedAt) : accessAt(url, { issuedAt }))),
            ),
          ),
        ),
      ),
    )
    const connection = yield* connect(environments)
    yield* TestClock.adjust(Duration.seconds(61))
    const hellos = yield* Effect.all(
      Array.from({ length: 10 }, () => connection.client["executor.hello"]()),
      { concurrency: "unbounded" },
    )
    expect(hellos.map((hello) => hello.environmentId)).toEqual(Array.from({ length: 10 }, () => environmentId))
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.effect("a refresh that ends after a failed call closed the connection leaves the new connection alone", () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    const old = yield* Probe.make({
      afterSpawn: () => Deferred.succeed(arrived, undefined).pipe(Effect.andThen(Effect.never)),
    })
    const relay = yield* Relay.make(Relay.portOf(yield* Probe.start({ environmentId, workspace, executor: old.layer })))
    const next = yield* machine({ environmentId, workspace: elsewhere })
    const subject = yield* controlled(
      yield* accessAt(relay.url, { issuedAt: yield* Clock.currentTimeMillis, lifetimeMs: 900_000 }),
    )
    const stale = yield* connect(subject.environments)
    yield* TestClock.adjust(Duration.seconds(599))
    const failing = yield* stale.client["process.spawn"]({ command: "true", arguments: [] }).pipe(
      Effect.flip,
      Effect.forkScoped,
    )
    yield* Deferred.await(arrived)
    const gate = yield* subject.holdNextOpen
    yield* TestClock.adjust(Duration.seconds(2))
    const refresh = yield* stale.client["executor.hello"]().pipe(Effect.exit, Effect.forkScoped)
    yield* Deferred.await(gate.entered)
    yield* relay.refuse(true)
    yield* relay.cut
    expect(ExecutorClient.isNoAnswer(yield* Fiber.join(failing))).toBe(true)
    yield* Ref.set(
      subject.current,
      yield* accessAt(next, { root: elsewhere, generation: 2, issuedAt: yield* Clock.currentTimeMillis }),
    )
    const fresh = yield* connect(subject.environments)
    expect(fresh).not.toBe(stale)
    yield* Deferred.succeed(gate.release, undefined)
    yield* Fiber.join(refresh)
    expect(yield* connect(subject.environments)).toBe(fresh)
    expect(yield* which(fresh)).toBe(elsewhere)
  }),
)

it.effect("a subagent shares its parent's session: two calls during a refresh cause one refresh and both succeed", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const opens = yield* Ref.make(0)
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.getAndUpdate(opens, (count) => count + 1).pipe(
          Effect.tap((count) =>
            count === 1
              ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
              : Effect.void,
          ),
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 900_000 })),
        ),
      ),
    )
    yield* connect(environments)
    yield* TestClock.adjust(Duration.minutes(11))
    const call = Effect.scoped(connect(environments)).pipe(
      Effect.flatMap((connection) => connection.client["executor.hello"]()),
    )
    const parent = yield* Effect.forkScoped(call)
    yield* Deferred.await(entered)
    const subagent = yield* Effect.forkScoped(call)
    yield* Deferred.succeed(release, undefined)
    expect([(yield* Fiber.join(parent)).environmentId, (yield* Fiber.join(subagent)).environmentId]).toEqual([
      environmentId,
      environmentId,
    ])
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.effect("a call at the second a token expires works with a new token, with no refused request", () =>
  Effect.gen(function* () {
    const url = yield* Sandbox.url
    const link = yield* Probe.link
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 600_000 })),
        ),
      ),
      link.layer,
    )
    const connection = yield* connect(environments)
    yield* TestClock.adjust(Duration.minutes(10))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
    expect((yield* Ref.get(link.requests)).filter((request) => request.rpc === "executor.hello")).toHaveLength(2)
    expect(yield* connect(environments)).toBe(connection)
  }),
)
