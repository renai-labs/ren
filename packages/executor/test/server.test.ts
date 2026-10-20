import { expect } from "bun:test"
import { HandToken } from "@ren/hand-api/hand-token"
import { ExecutorApi } from "@ren/hand-api/executor-api"
import { ExecutorClient } from "@ren/hand-api/executor-client"
import { Signature } from "@ren/hand-api/signature"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Redacted, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { RpcClientError } from "effect/rpc"
import { TestClock } from "effect/testing"
import { mkdtemp } from "node:fs/promises"
import { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testEffect } from "./lib/effect.js"
import { TestHand } from "./lib/test-hand.js"
import { Processes } from "./lib/process.js"

const handId = Hand.ID.create()
const brain = Brain.ID.create()
const workspace = await mkdtemp(join(tmpdir(), "ren-executor-"))
const it = testEffect(TestHand.layer({ handId, workspace }).pipe(Layer.provideMerge(FetchHttpClient.layer)))

const token = Effect.fnUntraced(function* (claims: { readonly handId?: Hand.ID; readonly brain?: Brain.ID } = {}) {
  return Redacted.value(
    (yield* TestHand.access({ url: yield* TestHand.url, handId, brain, directory: workspace, ...claims })).token,
  )
})

const connect = Effect.fnUntraced(function* (bearer: string) {
  return yield* ExecutorClient.make({ url: new URL(yield* TestHand.url), token: Effect.succeed(bearer) })
})

const client = Effect.fnUntraced(function* (claims: { readonly brain?: Brain.ID } = {}) {
  return yield* connect(yield* token(claims))
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const rpc = (tag: string, payload: object | null) =>
  `${JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })}\n`

const post = Effect.fnUntraced(function* (body: string | Uint8Array, authorization?: string) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(`${yield* TestHand.url}${ExecutorClient.path}`).pipe(
    typeof body === "string"
      ? HttpClientRequest.bodyText(body, "application/ndjson")
      : HttpClientRequest.bodyUint8Array(body, "application/ndjson"),
    (built) =>
      authorization === undefined ? built : HttpClientRequest.setHeader(built, "authorization", authorization),
  )
  const response = yield* http.execute(request)
  return { status: response.status, body: yield* response.text }
})

const refused = Effect.fnUntraced(function* () {
  const valid = yield* token()
  const other = yield* Signature.generate("other")
  const impostor = yield* Signature.generate(TestHand.keys.publicKey.id)
  const claims = { hand: handId, brain, exp: Math.floor(Date.now() / 1000) + 600 }
  return [
    {
      name: "a key the executor does not know",
      authorization: `Bearer ${yield* HandToken.sign(other.privateKey, claims)}`,
    },
    {
      name: "a known key id signed by another key",
      authorization: `Bearer ${yield* HandToken.sign(impostor.privateKey, claims)}`,
    },
    {
      name: "another token type",
      authorization: `Bearer ${yield* Signature.sign(TestHand.keys.privateKey, { ...claims, typ: "host" })}`,
    },
    {
      name: "a token for another environment",
      authorization: `Bearer ${yield* token({ handId: Hand.ID.create() })}`,
    },
    {
      name: "an expired token",
      authorization: `Bearer ${Redacted.value((yield* TestHand.access({ url: yield* TestHand.url, handId, brain, directory: workspace, issuedAt: Date.now() - 3_600_000 })).token)}`,
    },
    { name: "another scheme", authorization: `Basic ${valid}` },
  ]
})

it.live("answers a bad token before it decodes the payload", () =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const invalidSpawn = HttpClientRequest.post(`${yield* TestHand.url}${ExecutorClient.path}`).pipe(
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
      yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken(yield* token({ handId: Hand.ID.create() })))),
    ).toEqual(unauthorized)
    expect(yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken("not.a-token")))).toEqual(unauthorized)
    const decoded = yield* answer(invalidSpawn.pipe(HttpClientRequest.bearerToken(yield* token())))
    expect(decoded.status).toBe(200)
    expect(decoded.body).toContain("Die")
  }),
)

it.live("gives a client with a bad token the typed UnauthorizedError", () =>
  Effect.gen(function* () {
    const foreign = yield* connect(yield* token({ handId: Hand.ID.create() }))
    const empty = yield* connect("")
    const errors = yield* Effect.forEach([foreign, empty], (api) =>
      Effect.all([
        api["files.stat"]({ path: "." }).pipe(Effect.flip),
        api["process.output"]({ id: ExecutorApi.ProcessID.create() }).pipe(Stream.runDrain, Effect.flip),
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
    expect(failed._tag).toBe("SpawnFailedError")
    const spawned = yield* api["process.spawn"]({ command: "sleep", arguments: ["5"] })
    const other = yield* client({ brain: Brain.ID.create() })
    expect((yield* other["process.output"]({ id: spawned.id }).pipe(Stream.runDrain, Effect.flip))._tag).toBe(
      "ProcessNotFoundError",
    )
    expect(
      (yield* api["process.kill"]({ id: ExecutorApi.ProcessID.create(), signal: "SIGTERM" }).pipe(Effect.flip))._tag,
    ).toBe("ProcessNotFoundError")
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

it.live("refuses a token of another type, from an unknown key or scheme, and takes a lowercase bearer", () =>
  Effect.gen(function* () {
    const hello = rpc("executor.hello", null)
    const statuses = yield* Effect.forEach(yield* refused(), (entry) =>
      Effect.map(post(hello, entry.authorization), (answer) => ({ name: entry.name, status: answer.status })),
    )
    expect(statuses.filter((entry) => entry.status !== 401)).toEqual([])
    const valid = yield* token()
    const lowercase = yield* post(hello, `bearer ${valid}`)
    expect(lowercase.status).toBe(200)
    expect(lowercase.body).toContain(handId)
  }),
)

it.live("answers a token for another environment with 401 and starts no process", () =>
  Effect.gen(function* () {
    const marker = `ren-d4-${crypto.randomUUID()}`
    const spawn = rpc("process.spawn", { command: "sh", arguments: ["-c", "sleep 30; true", marker] })
    const foreign = yield* post(spawn, `Bearer ${yield* token({ handId: Hand.ID.create() })}`)
    expect(foreign.status).toBe(401)
    expect(foreign.body).not.toContain("prc_")
    expect(Processes.matching(marker)).toEqual([])
    const control = yield* post(spawn, `Bearer ${yield* token()}`)
    expect(control.status).toBe(200)
    expect(Processes.matching(marker)).not.toEqual([])
    for (const pid of Processes.matching(marker)) process.kill(pid, "SIGKILL")
  }),
)

it.live("keeps a refused token out of its error", () =>
  Effect.gen(function* () {
    const hello = rpc("executor.hello", null)
    const answers = yield* Effect.forEach(yield* refused(), (entry) =>
      Effect.map(post(hello, entry.authorization), (answer) => ({
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
    const typed = yield* connect("not.a-token").pipe(
      Effect.flatMap((api) => api["files.stat"]({ path: "." }).pipe(Effect.flip)),
    )
    expect(JSON.stringify(typed)).not.toContain("not.a-token")
  }),
)

it.live("refuses an Authorization header with no token, two tokens or 64 KiB of text, and keeps serving", () =>
  Effect.gen(function* () {
    const hello = rpc("executor.hello", null)
    const valid = yield* token()
    const statuses = yield* Effect.forEach(
      ["Bearer", "Bearer ", `Bearer ${valid} ${valid}`, `Bearer ${"a".repeat(64 * 1024)}`],
      (authorization) => Effect.map(post(hello, authorization), (answer) => answer.status),
    )
    expect(statuses).toEqual([401, 401, 401, 431])
    expect((yield* post(hello, `Bearer ${valid}`)).status).toBe(200)
  }),
)

it.effect("keeps streaming output to a reader whose token expires, and refuses that token afterwards", () =>
  Effect.gen(function* () {
    const expiring = yield* TestHand.access({
      url: yield* TestHand.url,
      handId,
      brain,
      directory: workspace,
      issuedAt: 0,
      lifetimeMs: 60_000,
    })
    const reader = yield* connect(Redacted.value(expiring.token))
    const writer = yield* client()
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
    const bearer = `Bearer ${yield* token()}`
    const answer = yield* post(rpc("process.output", { id: ExecutorApi.ProcessID.create(), cursor: -1 }), bearer)
    expect(answer.body).toContain("Die")
    expect(answer.body).toContain("Expected a value greater than or equal to 0")
    expect((yield* post(rpc("executor.hello", null), bearer)).status).toBe(200)
  }),
)

it.live("answers a body that is not NDJSON or that is cut off with a status 500, and keeps serving", () =>
  Effect.gen(function* () {
    const bearer = `Bearer ${yield* token()}`
    const garbage = yield* post("this is not json\n", bearer)
    const cut = yield* post(rpc("executor.hello", null).slice(0, 30), bearer)
    expect([garbage.status, cut.status]).toEqual([500, 500])
    expect((yield* post(rpc("executor.hello", null), bearer)).status).toBe(200)
  }),
)

it.live(
  "answers a write above the file size limit by size: a typed error, then a defect, then status 413",
  () =>
    Effect.gen(function* () {
      const write = Effect.fnUntraced(function* (mebibytes: number) {
        const api = yield* client()
        const exit = yield* api["files.write"]({
          path: "too-large.bin",
          bytes: new Uint8Array(mebibytes * 1024 * 1024),
        }).pipe(Effect.exit)
        return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
      })
      const large = yield* write(9)
      expect(large instanceof ExecutorApi.FileTooLargeError).toBe(true)
      const framed = yield* write(20)
      expect(framed instanceof Error && framed.message).toContain("RPC serialization buffer exceeded")
      const refused = yield* write(100)
      expect(
        refused instanceof RpcClientError.RpcClientError &&
          refused.reason._tag === "HttpError" &&
          refused.reason.cause instanceof HttpClientError.StatusCodeError &&
          refused.reason.cause.response.status,
      ).toBe(413)
      expect((yield* (yield* client())["files.stat"]({ path: "." })).type).toBe("directory")
      expect(yield* Effect.promise(() => Bun.file(join(workspace, "too-large.bin")).exists())).toBe(false)
    }),
  60_000,
)

it.live(
  "answers 10 MiB of stdin to a process that never reads with StdinFullError at once, and a stop ends the process",
  () =>
    Effect.gen(function* () {
      const api = yield* client()
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
      expect(failures.some(ExecutorClient.isNoAnswer)).toBe(false)
      yield* api["process.kill"]({ id: spawned.id, signal: "SIGKILL" })
      const events = yield* api["process.output"]({ id: spawned.id }).pipe(Stream.runCollect)
      expect(events.at(-1)).toEqual({ type: "exit", exitCode: null, signal: "SIGKILL" })
      expect((yield* api["files.stat"]({ path: "." })).type).toBe("directory")
    }),
)

it.live(
  "releases a request whose client never ends its body or sends it a byte at a time, and serves others meanwhile",
  () =>
    Effect.gen(function* () {
      const bearer = `Bearer ${yield* token()}`
      const address = new URL(yield* TestHand.url)
      const startedAt = Date.now()
      const stalled = (options: { readonly trickle: boolean }) =>
        Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const socket = new Socket().connect(Number(address.port), address.hostname, () => {
                socket.write(
                  `POST ${ExecutorClient.path} HTTP/1.1\r\nHost: ${address.host}\r\nAuthorization: ${bearer}\r\nContent-Type: application/ndjson\r\nContent-Length: 1000\r\n\r\n{"_tag":"Request"`,
                )
                const timer = options.trickle ? setInterval(() => socket.write(" "), 4000) : undefined
                socket.on("close", () => clearInterval(timer))
              })
              socket.on("close", () => resolve(Date.now() - startedAt))
              socket.on("error", () => socket.destroy())
            }),
        ).pipe(Effect.forkScoped)
      const silent = yield* stalled({ trickle: false })
      const slow = yield* stalled({ trickle: true })
      expect((yield* post(rpc("executor.hello", null), bearer)).status).toBe(200)
      const released = yield* Effect.all([Fiber.join(silent), Fiber.join(slow)]).pipe(
        Effect.timeoutOption(Duration.seconds(20)),
      )
      expect(Option.isSome(released) && released.value.every((milliseconds) => milliseconds < 15_000)).toBe(true)
      expect((yield* post(rpc("executor.hello", null), bearer)).status).toBe(200)
    }),
  30_000,
)
