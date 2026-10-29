import { expect } from "bun:test"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { EnvironmentClient } from "@ren/environment-api/environment-client"
import { Signature } from "@ren/schema/signature"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Deferred, Duration, Effect, Fiber, Option, Redacted, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { TestClock } from "effect/testing"
import { join } from "node:path"
import { TestEnvironment } from "./lib/test-environment.js"
import { Processes } from "./lib/process.js"
import { testEffect } from "./lib/effect.js"
import { TestServer } from "./lib/server.js"

const it = testEffect(TestServer.layer)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const refused = Effect.fnUntraced(function* () {
  const valid = yield* TestServer.token()
  const other = yield* Signature.generate("other")
  const impostor = yield* Signature.generate(TestEnvironment.keys.publicKey.id)
  const claims = {
    environment: TestServer.environmentId,
    brain: TestServer.brain,
    exp: Math.floor(Date.now() / 1000) + 600,
  }
  return [
    {
      name: "a key the executor does not know",
      authorization: `Bearer ${yield* EnvironmentToken.sign(other.privateKey, claims)}`,
    },
    {
      name: "a known key id signed by another key",
      authorization: `Bearer ${yield* EnvironmentToken.sign(impostor.privateKey, claims)}`,
    },
    {
      name: "another token type",
      authorization: `Bearer ${yield* Signature.sign(TestEnvironment.keys.privateKey, { ...claims, typ: "host" })}`,
    },
    {
      name: "a token for another environment",
      authorization: `Bearer ${yield* TestServer.token({ environmentId: Environment.ID.create() })}`,
    },
    {
      name: "an expired token",
      authorization: `Bearer ${Redacted.value((yield* TestEnvironment.access({ url: yield* TestEnvironment.url, environmentId: TestServer.environmentId, brain: TestServer.brain, directory: TestServer.workspace, issuedAt: Date.now() - 3_600_000 })).token)}`,
    },
    { name: "another scheme", authorization: `Basic ${valid}` },
  ]
})

it.live("answers a bad token before it decodes the payload", () =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const invalidSpawn = HttpClientRequest.post(`${yield* TestEnvironment.url}${EnvironmentClient.path}`).pipe(
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
        invalidSpawn.pipe(
          HttpClientRequest.bearerToken(yield* TestServer.token({ environmentId: Environment.ID.create() })),
        ),
      ),
    ).toEqual(unauthorized)
    expect(yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken("not.a-token")))).toEqual(unauthorized)
    const decoded = yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken(yield* TestServer.token())))
    expect(decoded.status).toBe(200)
    expect(decoded.body).toContain("Die")
  }),
)

it.live("gives a client with a bad token the typed UnauthorizedError", () =>
  Effect.gen(function* () {
    const foreign = yield* TestServer.connect(yield* TestServer.token({ environmentId: Environment.ID.create() }))
    const empty = yield* TestServer.connect("")
    const errors = yield* Effect.forEach([foreign, empty], (api) =>
      Effect.all([
        api["files.stat"]({ path: "." }).pipe(Effect.flip),
        api["process.output"]({ id: EnvironmentApi.ProcessID.create() }).pipe(Stream.runDrain, Effect.flip),
      ]),
    )
    expect(errors.flat()).toEqual(
      Array(4).fill(expect.objectContaining({ _tag: "UnauthorizedError", message: "Authentication required" })),
    )
  }),
)

it.live("streams a process's bytes until it exits", () =>
  Effect.gen(function* () {
    const api = yield* TestServer.client()
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
    const api = yield* TestServer.client()
    const missing = yield* api["files.read"]({ path: "missing" }).pipe(Effect.flip)
    expect(missing._tag === "FileNotFoundError" && missing.path).toBe("missing")
    const failed = yield* api["process.spawn"]({ command: "ren-no-such-command", arguments: [] }).pipe(Effect.flip)
    expect(failed._tag).toBe("SpawnFailedError")
    const spawned = yield* api["process.spawn"]({ command: "sleep", arguments: ["5"] })
    const other = yield* TestServer.client({ brain: Brain.ID.create() })
    expect((yield* other["process.output"]({ id: spawned.id }).pipe(Stream.runDrain, Effect.flip))._tag).toBe(
      "ProcessNotFoundError",
    )
    expect(
      (yield* api["process.kill"]({ id: EnvironmentApi.ProcessID.create(), signal: "SIGTERM" }).pipe(Effect.flip))._tag,
    ).toBe("ProcessNotFoundError")
    yield* api["process.kill"]({ id: spawned.id, signal: "SIGKILL" })
  }),
)

it.live("refuses a token of another type, from an unknown key or scheme, and takes a lowercase bearer", () =>
  Effect.gen(function* () {
    const hello = TestServer.rpc("executor.hello", null)
    const statuses = yield* Effect.forEach(yield* refused(), (entry) =>
      Effect.map(TestServer.post(hello, entry.authorization), (answer) => ({
        name: entry.name,
        status: answer.status,
      })),
    )
    expect(statuses.filter((entry) => entry.status !== 401)).toEqual([])
    const valid = yield* TestServer.token()
    const lowercase = yield* TestServer.post(hello, `bearer ${valid}`)
    expect(lowercase.status).toBe(200)
    expect(lowercase.body).toContain(TestServer.environmentId)
  }),
)

it.live("answers a token for another environment with 401 and starts no process", () =>
  Effect.gen(function* () {
    const marker = `ren-d4-${crypto.randomUUID()}`
    const spawn = TestServer.rpc("process.spawn", { command: "sh", arguments: ["-c", "sleep 30; true", marker] })
    const foreign = yield* TestServer.post(
      spawn,
      `Bearer ${yield* TestServer.token({ environmentId: Environment.ID.create() })}`,
    )
    expect(foreign.status).toBe(401)
    expect(foreign.body).not.toContain("prc_")
    expect(Processes.matching(marker)).toEqual([])
    const control = yield* TestServer.post(spawn, `Bearer ${yield* TestServer.token()}`)
    expect(control.status).toBe(200)
    expect(Processes.matching(marker)).not.toEqual([])
    for (const pid of Processes.matching(marker)) process.kill(pid, "SIGKILL")
  }),
)

it.live("keeps a refused token out of its error", () =>
  Effect.gen(function* () {
    const hello = TestServer.rpc("executor.hello", null)
    const answers = yield* Effect.forEach(yield* refused(), (entry) =>
      Effect.map(TestServer.post(hello, entry.authorization), (answer) => ({
        authorization: entry.authorization,
        text: answer.body,
      })),
    )
    const leaked = answers.filter((answer) =>
      answer.authorization
        .split(/[ .]/)
        .filter((part) => part.length > 8)
        .some((part) => answer.text.includes(part)),
    )
    expect(leaked).toEqual([])
    const typed = yield* TestServer.connect("not.a-token").pipe(
      Effect.flatMap((api) => api["files.stat"]({ path: "." }).pipe(Effect.flip)),
    )
    expect(JSON.stringify(typed)).not.toContain("not.a-token")
  }),
)

it.live("refuses an Authorization header with no token, two tokens or 64 KiB of text, and keeps serving", () =>
  Effect.gen(function* () {
    const hello = TestServer.rpc("executor.hello", null)
    const valid = yield* TestServer.token()
    const statuses = yield* Effect.forEach(
      ["Bearer", "Bearer ", `Bearer ${valid} ${valid}`, `Bearer ${"a".repeat(64 * 1024)}`],
      (authorization) => Effect.map(TestServer.post(hello, authorization), (answer) => answer.status),
    )
    expect(statuses).toEqual([401, 401, 401, 431])
    expect((yield* TestServer.post(hello, `Bearer ${valid}`)).status).toBe(200)
  }),
)

it.effect("keeps streaming output to a reader whose token expires, and refuses that token afterwards", () =>
  Effect.gen(function* () {
    const expiring = yield* TestEnvironment.access({
      url: yield* TestEnvironment.url,
      environmentId: TestServer.environmentId,
      brain: TestServer.brain,
      directory: TestServer.workspace,
      issuedAt: 0,
      lifetimeMs: 60_000,
    })
    const reader = yield* TestServer.connect(Redacted.value(expiring.token))
    const writer = yield* TestServer.client()
    const spawned = yield* writer["process.spawn"]({ command: "cat", arguments: [], hasStdin: true })
    const first = yield* Deferred.make<void>()
    const events = yield* reader["process.output"]({ id: spawned.id }).pipe(
      Stream.tap((event) => (event.type === "stdout" ? Deferred.succeed(first, undefined) : Effect.void)),
      Stream.runCollect,
      Effect.forkScoped,
    )
    yield* writer["process.write"]({ id: spawned.id, data: encoder.encode("a"), end: false })
    yield* Deferred.await(first)
    yield* writer["process.heartbeat"]({ id: spawned.id }).pipe(
      Effect.andThen(TestClock.adjust(Duration.seconds(20))),
      Effect.repeat({ times: 5 }),
    )
    expect((yield* reader["files.stat"]({ path: "." }).pipe(Effect.flip))._tag).toBe("UnauthorizedError")
    yield* writer["process.write"]({ id: spawned.id, data: encoder.encode("b"), end: true })
    const all = [...(yield* Fiber.join(events))]
    expect(
      decoder.decode(
        new Uint8Array(Buffer.concat(all.flatMap((event) => (event.type === "stdout" ? [event.bytes] : [])))),
      ),
    ).toBe("ab")
    expect(all.at(-1)).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

it.live("refuses a negative cursor in the schema, and keeps serving", () =>
  Effect.gen(function* () {
    const bearer = `Bearer ${yield* TestServer.token()}`
    const answer = yield* TestServer.post(
      TestServer.rpc("process.output", { id: EnvironmentApi.ProcessID.create(), cursor: -1 }),
      bearer,
    )
    expect(answer.body).toContain("Die")
    expect(answer.body).toContain("Expected a value greater than or equal to 0")
    expect((yield* TestServer.post(TestServer.rpc("executor.hello", null), bearer)).status).toBe(200)
  }),
)

it.live("answers a body that is not NDJSON with a defect, drops a cut-off body, and keeps serving", () =>
  Effect.gen(function* () {
    const bearer = `Bearer ${yield* TestServer.token()}`
    const garbage = yield* TestServer.post("this is not json\n", bearer)
    const cut = yield* TestServer.post(TestServer.rpc("executor.hello", null).slice(0, 30), bearer)
    expect(garbage.body).toContain("NdjsonDecodeError")
    expect(cut.body).toBe("")
    expect((yield* TestServer.post(TestServer.rpc("executor.hello", null), bearer)).status).toBe(200)
  }),
)

it.live("answers a write above the file size limit with FileTooLargeError, writes no file, and keeps serving", () =>
  Effect.gen(function* () {
    const api = yield* TestServer.client()
    const failure = yield* api["files.write"]({ path: "too-large.bin", bytes: new Uint8Array(9 * 1024 * 1024) }).pipe(
      Effect.flip,
    )
    expect(failure._tag).toBe("FileTooLargeError")
    expect((yield* api["files.stat"]({ path: "." })).type).toBe("directory")
    expect(yield* Effect.promise(() => Bun.file(join(TestServer.workspace, "too-large.bin")).exists())).toBe(false)
  }),
)

it.live(
  "answers 10 MiB of stdin to a process that never reads with StdinFullError at once, and a stop ends the process",
  () =>
    Effect.gen(function* () {
      const api = yield* TestServer.client()
      const spawned = yield* api["process.spawn"]({ command: "sleep", arguments: ["60"], hasStdin: true })
      const chunk = new Uint8Array(64 * 1024)
      const startedAt = Date.now()
      const writes = yield* Effect.forEach(
        Array.from({ length: 160 }),
        () => api["process.write"]({ id: spawned.id, data: chunk, end: false }).pipe(Effect.flip, Effect.option),
        { concurrency: 1 },
      )
      const accepted = writes.findIndex(Option.isSome)
      const failures = writes.slice(accepted).flatMap((failure) => (Option.isSome(failure) ? [failure.value] : []))
      expect(Date.now() - startedAt).toBeLessThan(5000)
      expect(accepted).toBeGreaterThanOrEqual(16)
      expect(accepted).toBeLessThanOrEqual(32)
      expect(failures).toHaveLength(160 - accepted)
      expect(failures.map((failure) => failure._tag)).toEqual(Array(160 - accepted).fill("StdinFullError"))
      expect(failures.some(EnvironmentClient.isNoAnswer)).toBe(false)
      yield* api["process.kill"]({ id: spawned.id, signal: "SIGKILL" })
      const events = yield* api["process.output"]({ id: spawned.id }).pipe(Stream.runCollect)
      expect(events.at(-1)).toEqual({ type: "exit", exitCode: null, signal: "SIGKILL" })
      expect((yield* api["files.stat"]({ path: "." })).type).toBe("directory")
    }),
)
