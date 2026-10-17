import { expect } from "bun:test"
import { ProcessID } from "@ren/brain-api/executor-api"
import { ExecutorClient } from "@ren/brain-api/executor-client"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Deferred, Duration, Effect, Fiber, Layer, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { TestClock } from "effect/testing"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testEffect } from "./lib/effect.js"
import { Machine } from "./lib/machine.js"
import { Processes } from "./lib/process.js"

const environmentId = Environment.ID.create()
const brain = Brain.ID.create()
const it = testEffect(
  Machine.layer({ environmentId, workspace: await mkdtemp(join(tmpdir(), "ren-executor-")) }).pipe(
    Layer.provideMerge(FetchHttpClient.layer),
  ),
)

const token = Effect.fnUntraced(function* (
  claims: { readonly environmentId?: Environment.ID; readonly brain?: Brain.ID } = {},
) {
  return (yield* Machine.access({ url: yield* Machine.url, environmentId, brain, ...claims })).token
})

const connect = Effect.fnUntraced(function* (bearer: string) {
  return yield* ExecutorClient.make({ url: yield* Machine.url, token: Effect.succeed(bearer) })
})

const client = Effect.fnUntraced(function* (claims: { readonly brain?: Brain.ID } = {}) {
  return yield* connect(yield* token(claims))
})

it.live("answers a bad token before it decodes the payload", () =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const invalidSpawn = HttpClientRequest.post(`${yield* Machine.url}${ExecutorClient.path}`).pipe(
      HttpClientRequest.bodyText(
        `${JSON.stringify({ _tag: "Request", id: "1", tag: "process.spawn", payload: { command: 42 }, headers: [] })}\n`,
        "application/ndjson",
      ),
    )
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
      yield* answer(
        invalidSpawn.pipe(HttpClientRequest.bearerToken(yield* token({ environmentId: Environment.ID.create() }))),
      ),
    ).toEqual(unauthorized)
    expect(yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken("not.a-token")))).toEqual(unauthorized)
    const decoded = yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken(yield* token())))
    expect(decoded.status).toBe(200)
    expect(decoded.body).toContain("Die")
  }),
)

it.live("gives a client with a bad token the typed UnauthorizedError", () =>
  Effect.gen(function* () {
    const foreign = yield* connect(yield* token({ environmentId: Environment.ID.create() }))
    const empty = yield* connect("")
    const errors = yield* Effect.forEach([foreign, empty], (api) =>
      Effect.all([
        api["files.stat"]({ path: "." }).pipe(Effect.flip),
        api["process.output"]({ id: ProcessID.create() }).pipe(Stream.runDrain, Effect.flip),
      ]),
    )
    expect(errors.flat()).toEqual(
      Array(4).fill(expect.objectContaining({ _tag: "UnauthorizedError", message: "Authentication required" })),
    )
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
    yield* Fiber.interrupt(reader)
    const exited = yield* TestClock.adjust(Duration.seconds(31)).pipe(
      Effect.andThen(Processes.exits(spawned.pid)),
      Effect.repeat({ until: (gone) => gone, times: 3 }),
    )
    expect(exited).toBe(true)
    expect((yield* api["process.kill"]({ id: spawned.id }).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)
