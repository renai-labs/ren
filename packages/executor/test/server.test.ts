import { expect } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { ProcessID } from "@ren/brain-api/executor-api"
import { ExecutorClient } from "@ren/brain-api/executor-client"
import { Signature } from "@ren/brain-api/signature"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { ConfigProvider, Deferred, Duration, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TestClock } from "effect/testing"
import { NodeCompatible } from "../src/node-compatible.js"
import { Server } from "../src/server.js"
import { testEffect } from "./lib/effect.js"
import { Processes } from "./lib/process.js"

const pair = await Effect.runPromise(Signature.generate("test"))
const environmentId = Environment.ID.create()
const brain = Brain.ID.create()
const it = testEffect(
  HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(NodeCompatible.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: environmentId,
          EXECUTOR_WORKSPACE: await mkdtemp(join(tmpdir(), "ren-executor-")),
          BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)([pair.publicKey]),
        }),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layerTest),
  ),
)

const token = (claims: Partial<EnvironmentToken.Claims> = {}) =>
  EnvironmentToken.sign(pair.privateKey, {
    env: environmentId,
    brain,
    exp: Math.floor(Date.now() / 1000) + 60,
    ...claims,
  })

const connect = Effect.fnUntraced(function* (bearer: string) {
  const server = yield* HttpServer.HttpServer
  return yield* ExecutorClient.make({
    url: HttpServer.formatAddress(server.address),
    token: Effect.succeed(bearer),
  }).pipe(Effect.provide(FetchHttpClient.layer))
})

const client = Effect.fnUntraced(function* (claims: Partial<EnvironmentToken.Claims> = {}) {
  return yield* connect(yield* token(claims))
})

const invalidSpawn = HttpClientRequest.post("/v1/rpc").pipe(
  HttpClientRequest.bodyText(
    `${JSON.stringify({ _tag: "Request", id: "1", tag: "process.spawn", payload: { command: 42 }, headers: [] })}\n`,
    "application/ndjson",
  ),
)

it.live("answers a bad token before it decodes the payload", () =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const answer = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
      const response = yield* http.execute(request)
      return { status: response.status, body: yield* response.text }
    })
    const unauthorized = {
      status: 401,
      body: JSON.stringify({ _tag: "UnauthorizedError", message: "Authentication required" }),
    }
    expect(yield* answer(invalidSpawn)).toEqual(unauthorized)
    expect(
      yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken(yield* token({ env: Environment.ID.create() })))),
    ).toEqual(unauthorized)
    expect(yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken("not.a-token")))).toEqual(unauthorized)
    const decoded = yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken(yield* token())))
    expect(decoded.status).toBe(200)
    expect(decoded.body).toContain("Die")
  }),
)

it.live("gives a client with a bad token the typed UnauthorizedError", () =>
  Effect.gen(function* () {
    const foreign = yield* client({ env: Environment.ID.create() })
    const expired = yield* client({ exp: Math.floor(Date.now() / 1000) - 60 })
    const malformed = yield* connect("not.a-token")
    const empty = yield* connect("")
    const errors = yield* Effect.forEach([foreign, expired, malformed, empty], (api) =>
      Effect.all([
        api["executor.hello"]().pipe(Effect.flip),
        api["files.stat"]({ path: "." }).pipe(Effect.flip),
        api["process.output"]({ id: ProcessID.create() }).pipe(Stream.runDrain, Effect.flip),
      ]),
    )
    expect(errors.flat().map((error) => error._tag)).toEqual(Array(12).fill("UnauthorizedError"))
    expect(errors[0]?.[0]).toMatchObject({ message: "Authentication required" })
  }),
)

it.live("describes itself", () =>
  Effect.gen(function* () {
    const api = yield* client()
    const hello = yield* api["executor.hello"]()
    expect(hello).toMatchObject({ protocol: 1, environmentId, capabilities: ["processes", "files"] })
  }),
)

it.live("streams a process's bytes until it exits", () =>
  Effect.gen(function* () {
    const api = yield* client()
    const spawned = yield* api["process.spawn"]({
      command: "sh",
      arguments: ["-c", "printf '\\000\\377'; sleep 0.2; echo done"],
    })
    const events = yield* api["process.output"]({ id: spawned.id }).pipe(Stream.runCollect)
    expect(events.at(0)).toEqual({ type: "stdout", offset: 0, bytes: new Uint8Array([0, 255]) })
    expect(events.at(-1)).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

it.live("gives stdin through the write call", () =>
  Effect.gen(function* () {
    const api = yield* client()
    const spawned = yield* api["process.spawn"]({ command: "cat", arguments: [], hasStdin: true })
    yield* api["process.write"]({ id: spawned.id, data: new TextEncoder().encode("ping"), end: true })
    const events = yield* api["process.output"]({ id: spawned.id }).pipe(Stream.runCollect)
    expect(events).toEqual([
      { type: "stdout", offset: 0, bytes: new TextEncoder().encode("ping") },
      { type: "exit", exitCode: 0, signal: null },
    ])
  }),
)

it.live("streams every event of one process to each of its readers", () =>
  Effect.gen(function* () {
    const api = yield* client()
    const spawned = yield* api["process.spawn"]({ command: "sh", arguments: ["-c", "sleep 0.3; echo one; exit 4"] })
    const outputs = yield* Effect.all(
      [api["process.output"]({ id: spawned.id }), api["process.output"]({ id: spawned.id })].map((stream) =>
        stream.pipe(
          Stream.filter((event) => event.type !== "ping"),
          Stream.runCollect,
        ),
      ),
      { concurrency: "unbounded" },
    )
    const expected = [
      { type: "stdout" as const, offset: 0, bytes: new TextEncoder().encode("one\n") },
      { type: "exit" as const, exitCode: 4, signal: null },
    ]
    expect(outputs).toEqual([expected, expected])
  }),
)

it.live("resumes a process's output from the cursor a dropped reader reached", () =>
  Effect.gen(function* () {
    const api = yield* client()
    const spawned = yield* api["process.spawn"]({
      command: "sh",
      arguments: ["-c", "echo first; sleep 0.5; echo second; exit 2"],
    })
    const first = yield* api["process.output"]({ id: spawned.id }).pipe(
      Stream.filter((event) => event.type === "stdout"),
      Stream.take(1),
      Stream.runCollect,
    )
    const reached = first.map((event) => event.offset + event.bytes.length)
    expect(reached).toEqual([6])
    const rest = yield* api["process.output"]({ id: spawned.id, cursor: 6 }).pipe(
      Stream.filter((event) => event.type !== "ping"),
      Stream.runCollect,
    )
    expect(rest).toEqual([
      { type: "stdout", offset: 6, bytes: new TextEncoder().encode("second\n") },
      { type: "exit", exitCode: 2, signal: null },
    ])
  }),
)

it.live("returns the declared errors", () =>
  Effect.gen(function* () {
    const api = yield* client()
    const missing = yield* api["files.read"]({ path: "missing" }).pipe(Effect.flip)
    expect(missing._tag === "FileNotFoundError" && missing.path).toBe("missing")
    const failed = yield* api["process.spawn"]({ command: "ren-no-such-command", arguments: [] }).pipe(Effect.flip)
    expect(failed._tag).toBe("OperationFailedError")
    const spawned = yield* api["process.spawn"]({ command: "sleep", arguments: ["5"] })
    const other = yield* client({ brain: Brain.ID.create() })
    expect((yield* other["process.output"]({ id: spawned.id }).pipe(Stream.runDrain, Effect.flip))._tag).toBe(
      "ProcessNotFoundError",
    )
    expect((yield* api["process.kill"]({ id: ProcessID.create() }).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
    yield* api["process.kill"]({ id: spawned.id, signal: "SIGKILL" })
  }),
)

it.live("reads and changes files", () =>
  Effect.gen(function* () {
    const api = yield* client()
    yield* api["files.write"]({ path: "rpc/a.txt", bytes: new TextEncoder().encode("hello world") })
    const read = yield* api["files.read"]({ path: "rpc/a.txt", range: { offset: 6, length: 100 } })
    expect(new TextDecoder().decode(read.bytes)).toBe("world")
    expect(yield* api["files.list"]({ path: "rpc" })).toEqual([{ name: "a.txt", type: "file" }])
    yield* api["files.mkdir"]({ path: "rpc/b" })
    yield* api["files.move"]({ from: "rpc/a.txt", to: "rpc/b" })
    expect((yield* api["files.stat"]({ path: "rpc/b/a.txt" })).sizeBytes).toBe(11)
    const kind = yield* api["files.list"]({ path: "rpc/b/a.txt" }).pipe(Effect.flip)
    expect(kind._tag === "WrongKindError" && kind.actual).toBe("file")
    yield* api["files.remove"]({ path: "rpc" })
    expect((yield* api["files.stat"]({ path: "rpc" }).pipe(Effect.flip))._tag).toBe("FileNotFoundError")
  }),
)

it.live(
  "keeps a silent process's output stream open past the server's idle timeout",
  () =>
    Effect.gen(function* () {
      const api = yield* client()
      const spawned = yield* api["process.spawn"]({ command: "sh", arguments: ["-c", "sleep 12; echo late"] })
      const events = yield* api["process.output"]({ id: spawned.id }).pipe(Stream.runCollect)
      expect(events.findLast((event) => event.type !== "ping")).toEqual({ type: "exit", exitCode: 0, signal: null })
    }),
  20_000,
)

it.effect("stops counting a reader whose stream was interrupted, so the 30-second rule applies again", () =>
  Effect.gen(function* () {
    const api = yield* client()
    const spawned = yield* api["process.spawn"]({ command: "sh", arguments: ["-c", "echo ready; sleep 60"] })
    const ready = yield* Deferred.make<void>()
    const reader = yield* api["process.output"]({ id: spawned.id }).pipe(
      Stream.tap(() => Deferred.succeed(ready, undefined)),
      Stream.runDrain,
      Effect.forkScoped,
    )
    yield* Deferred.await(ready)
    yield* TestClock.adjust(Duration.seconds(60))
    yield* api["process.kill"]({ id: spawned.id, signal: "SIGCONT" })
    expect(Processes.running(spawned.pid)).toBe(true)

    yield* Fiber.interrupt(reader)
    yield* Effect.promise(() => Bun.sleep(300))
    yield* TestClock.adjust(Duration.seconds(31))
    yield* Effect.promise(() => Bun.sleep(300))
    expect((yield* api["process.kill"]({ id: spawned.id }).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
    expect(yield* Processes.exits(spawned.pid)).toBe(true)
  }),
)
