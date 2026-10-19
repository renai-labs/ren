import { expect } from "bun:test"
import { TestAccess } from "./lib/access.js"
import { BunServices } from "@effect/platform-bun"
import type { SpawnResult } from "@ren/hand-api/executor-api"
import { Sandbox, Processes, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { ID } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import {
  Clock,
  Context,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Schedule,
  Scope,
  Stream,
} from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HandAccess } from "../src/hand-access.js"
import { HandConnections } from "../src/hand-connections.js"
import { Hand } from "../src/hand.js"
import { Probe } from "./lib/probe.js"

const handId = ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-hand-")))
const it = testEffect(Sandbox.layer({ handId, workspace }))

class Killed extends Error {
  constructor(readonly signal: string) {
    super(`Killed by ${signal}`)
  }
}

const killed = (signal: string) => new Killed(signal)

const sessionId = Session.ID.create()

const accessAt = (url: string) =>
  Sandbox.access({ url, handId, brain: Brain.ofSession(sessionId), directory: join(workspace, sessionId) })

const environmentsWith = (
  access: Layer.Layer<HandAccess.Service>,
  http: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer,
) =>
  Layer.build(HandConnections.layer.pipe(Layer.provide(access), Layer.provide(http))).pipe(
    Effect.map((context) => Context.get(context, HandConnections.Service)),
  )

const connectTo = Effect.fnUntraced(function* (url: string, http?: Layer.Layer<HttpClient.HttpClient>) {
  const environments = yield* environmentsWith(TestAccess.fixed(new Map([[sessionId, yield* accessAt(url)]])), http)
  return yield* environments.connect(sessionId)
})

const connect = Effect.flatMap(Sandbox.url, connectTo)

const throughRelay = Effect.gen(function* () {
  const relay = yield* Relay.make(Relay.portOf(yield* Sandbox.url))
  return { relay, spawner: Hand.spawner(yield* connectTo(relay.url), killed) }
})

it.live("fails the exit code with the host's signal error", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const handle = yield* spawner.spawn(ChildProcess.make("sleep", ["30"]))
    yield* handle.kill({ killSignal: "SIGTERM" })
    const error = yield* handle.exitCode.pipe(Effect.flip)
    expect(error.cause instanceof Killed && error.cause.signal).toBe("SIGTERM")
  }),
)

it.live("feeds stdin that outruns the sandbox's stdin queue without losing a byte", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const chunk = new Uint8Array(64 * 1024).fill(97)
    const handle = yield* spawner.spawn(
      ChildProcess.make("sh", ["-c", "sleep 0.3; wc -c"], {
        stdin: Stream.make(...Array.from({ length: 40 }, () => chunk)),
      }),
    )
    expect((yield* text(handle.stdout)).trim()).toBe(String(40 * 64 * 1024))
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

const text = (stream: Stream.Stream<Uint8Array, unknown>) => Stream.decodeText(stream).pipe(Stream.mkString)

const firstLine = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.decodeText(stream).pipe(Stream.take(1), Stream.mkString)

it.live("runs a command and gives its output and exit code", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const handle = yield* spawner.spawn(ChildProcess.make("sh", ["-c", "echo out; echo err >&2; exit 3"]))
    expect(yield* text(handle.stdout)).toBe("out\n")
    expect(yield* text(handle.stderr)).toBe("err\n")
    expect(Number(yield* handle.exitCode)).toBe(3)
  }),
)

it.live("feeds a stdin stream and closes it when the stream ends", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const handle = yield* spawner.spawn(
      ChildProcess.make("cat", [], {
        stdin: Stream.make(new TextEncoder().encode("one "), new TextEncoder().encode("two")),
      }),
    )
    expect(yield* text(handle.stdout)).toBe("one two")
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

it.live("ends stdin when a stream run into the stdin sink ends, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const handle = yield* spawner.spawn(ChildProcess.make("cat", []))
    yield* Stream.make(new TextEncoder().encode("sink")).pipe(Stream.run(handle.stdin))
    expect(Number(yield* handle.exitCode.pipe(Effect.timeout(2_000)))).toBe(0)
    expect(yield* text(handle.stdout)).toBe("sink")
  }),
)

it.live("loses no output and keeps the exit code when the connection drops mid-command", () =>
  Effect.gen(function* () {
    const through = yield* throughRelay
    const handle = yield* through.spawner.spawn(
      ChildProcess.make("sh", ["-c", "echo one; sleep 0.5; echo two; sleep 0.5; echo three; exit 7"]),
    )
    const first = yield* firstLine(handle.stdout)
    yield* through.relay.cut
    expect(first + (yield* text(handle.stdout))).toBe("one\ntwo\nthree\n")
    expect(yield* text(handle.stderr)).toBe("")
    expect(Number(yield* handle.exitCode)).toBe(7)
  }),
)

it.live("says the environment lost the command when a restarted executor no longer knows it", () =>
  Effect.gen(function* () {
    const through = yield* throughRelay
    const restarted = yield* Layer.build(Layer.fresh(Sandbox.layer({ handId, workspace }))).pipe(
      Effect.flatMap((context) => Effect.provide(Sandbox.url, context)),
    )
    const handle = yield* through.spawner.spawn(ChildProcess.make("sh", ["-c", "echo started; sleep 30"]))
    yield* firstLine(handle.stdout)
    yield* through.relay.target(Relay.portOf(restarted))
    yield* through.relay.cut
    yield* handle.exitCode.pipe(Effect.flip, Effect.timeout(10_000))
    expect(yield* text(handle.stderr)).toContain("[hand disconnected: the command did not finish]")
  }),
)

it.live("notes how much output was lost when the executor no longer has it", () =>
  Effect.gen(function* () {
    const through = yield* throughRelay
    const handle = yield* through.spawner.spawn(
      ChildProcess.make("sh", ["-c", "echo start; sleep 0.5; head -c 3000000 /dev/zero; echo; echo end"]),
    )
    yield* firstLine(handle.stdout)
    yield* through.relay.refuse(true)
    yield* through.relay.cut
    expect(yield* Processes.exits(handle.pid)).toBe(true)
    yield* through.relay.refuse(false)
    const stdout = yield* text(handle.stdout)
    expect(stdout.endsWith("\nend\n")).toBe(true)
    expect(yield* text(handle.stderr)).toMatch(/\[hand reconnected: \d+ bytes of output were lost\]/)
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

it.live("keeps the output and exit code of two commands running at once apart", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const run = (name: string, code: number) =>
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make("sh", [
            "-c",
            `for i in 1 2 3; do echo ${name}$i; echo ${name}-err$i >&2; sleep 0.1; done; exit ${code}`,
          ]),
        )
        const [stdout, stderr, exit] = yield* Effect.all([text(handle.stdout), text(handle.stderr), handle.exitCode], {
          concurrency: "unbounded",
        })
        return { stdout, stderr, exit: Number(exit) }
      })
    const [left, right] = yield* Effect.all([run("left", 3), run("right", 4)], { concurrency: "unbounded" })
    expect(left).toEqual({ stdout: "left1\nleft2\nleft3\n", stderr: "left-err1\nleft-err2\nleft-err3\n", exit: 3 })
    expect(right).toEqual({
      stdout: "right1\nright2\nright3\n",
      stderr: "right-err1\nright-err2\nright-err3\n",
      exit: 4,
    })
  }),
)

it.live("runs a shell script in a shell the machine has, and leaves other commands alone", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const lacking = yield* spawner.spawn(ChildProcess.make("/no/such/dir/ksh", ["-c", "echo $((6 * 7))"]))
    expect(yield* text(lacking.stdout)).toBe("42\n")
    expect(Number(yield* lacking.exitCode)).toBe(0)
    const present = yield* spawner.spawn(ChildProcess.make("/bin/sh", ["-c", 'echo "${ZSH_VERSION:-not zsh}"']))
    expect(yield* text(present.stdout)).toBe("not zsh\n")
    const notScript = yield* spawner.spawn(ChildProcess.make("/no/such/dir/ksh", ["--version"])).pipe(Effect.flip)
    expect(notScript.reason._tag).toBe("Unknown")
  }),
)

// oxlint-disable-next-line ren/no-comments -- Ren sends no change notices, so the brain finds the replacement when it refreshes a short token.
const replaceable = Effect.gen(function* () {
  const access = yield* Sandbox.access({
    url: yield* Sandbox.url,
    handId,
    brain: Brain.ofSession(sessionId),
    directory: join(workspace, sessionId),
    lifetimeMs: 6_000,
  })
  const context = yield* Layer.build(TestAccess.memory(new Map([[sessionId, access]])))
  const environments = yield* environmentsWith(Layer.succeedContext(context))
  const original = yield* Effect.scoped(environments.connect(sessionId))
  const replacement = yield* Scope.make()
  const next = yield* Layer.buildWithScope(Layer.fresh(Sandbox.layer({ handId, workspace })), replacement).pipe(
    Effect.flatMap((built) => Effect.provide(Sandbox.url, built)),
  )
  return {
    hand: Hand.session(environments, sessionId, killed),
    replace: Context.get(context, TestAccess.Memory)
      .set(sessionId, { ...access, url: new URL(next), generation: 2 })
      .pipe(
        Effect.andThen(
          Effect.scoped(environments.connect(sessionId)).pipe(
            Effect.repeat({ until: (current) => current !== original, schedule: Schedule.spaced(50) }),
            Effect.timeout(10_000),
          ),
        ),
      ),
    stopReplacement: Scope.close(replacement, Exit.void),
  }
})

it.live(
  "a command started before a replacement finishes there and returns its result, and the next goes to the new sandbox",
  () =>
    Effect.gen(function* () {
      const subject = yield* replaceable
      const old = yield* subject.hand.spawner.spawn(ChildProcess.make("sh", ["-c", "sleep 0.5; echo old; exit 6"]))
      yield* subject.replace
      const next = yield* subject.hand.spawner.spawn(ChildProcess.make("sh", ["-c", "echo new"]))
      expect(yield* text(next.stdout)).toBe("new\n")
      expect(yield* text(old.stdout)).toBe("old\n")
      expect(Number(yield* old.exitCode)).toBe(6)
      yield* subject.stopReplacement
      const after = yield* subject.hand.spawner.spawn(ChildProcess.make("true", [])).pipe(Effect.flip)
      expect(after.reason._tag).toBe("Unknown")
    }),
)

it.live(
  "a spawner that writes to an output file in the session's folder writes it in the session's folder on the sandbox",
  () =>
    Effect.gen(function* () {
      const environments = yield* environmentsWith(
        TestAccess.fixed(new Map([[sessionId, yield* accessAt(yield* Sandbox.url)]])),
      )
      const hand = Hand.session(environments, sessionId, killed)
      const name = `${crypto.randomUUID()}.out`
      const handle = yield* hand
        .spawnerWith({ outputFile: join(workspace, sessionId, name) })
        .spawn(ChildProcess.make("sh", ["-c", "echo written"]))
      expect(yield* text(handle.stdout)).toBe("written\n")
      expect(yield* Effect.promise(() => Bun.file(join(workspace, sessionId, name)).text())).toBe("written\n")
    }),
)

it.live("a spawner with a window gets only the last output and counts the bytes and newlines it skipped", () =>
  Effect.gen(function* () {
    const skipped = { bytes: 0, newlines: 0 }
    const handle = yield* Hand.spawner(yield* connect, killed, {
      window: { maxBytes: 1000, intervalMs: 100 },
      onSkip: (skip) => {
        skipped.bytes += skip.length
        skipped.newlines += skip.newlines
      },
    }).spawn(ChildProcess.make("seq", ["1", "100000"]))
    const shown = yield* text(handle.stdout)
    expect({
      bytes: skipped.bytes + shown.length,
      newlines: skipped.newlines + shown.split("\n").length - 1,
      ending: shown.endsWith("99999\n100000\n"),
      stderr: yield* text(handle.stderr),
    }).toEqual({ bytes: 588895, newlines: 100000, ending: true, stderr: "" })
    expect(shown.length).toBeLessThan(100_000)
  }),
)

it.live("stopping a command after a replacement still kills it on the old sandbox", () =>
  Effect.gen(function* () {
    const subject = yield* replaceable
    const scope = yield* Scope.make()
    const old = yield* subject.hand.spawner.spawn(ChildProcess.make("sleep", ["30"])).pipe(Scope.provide(scope))
    yield* subject.replace
    yield* Scope.close(scope, Exit.void)
    expect(yield* Processes.exits(old.pid)).toBe(true)
  }),
)

const local = Layer.build(BunServices.layer).pipe(
  Effect.map((context) => Context.get(context, ChildProcessSpawner.ChildProcessSpawner)),
)

const bothSpawners = Effect.gen(function* () {
  return [
    { name: "ren", spawner: Hand.spawner(yield* connect, killed) },
    { name: "local", spawner: yield* local },
  ] as const
})

const encoder = new TextEncoder()

const exitOf = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  handle.exitCode.pipe(
    Effect.map(Number),
    Effect.catch(() => Effect.succeed("failed" as const)),
  )

it.live("gives stdout and stderr together in all, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(yield* bothSpawners, (subject) =>
      Effect.gen(function* () {
        const handle = yield* subject.spawner.spawn(ChildProcess.make("sh", ["-c", "echo out; echo err >&2"]))
        return { lines: (yield* text(handle.all)).split("\n").filter(Boolean).toSorted(), exit: yield* exitOf(handle) }
      }),
    )
    expect(results.at(1)).toEqual({ lines: ["err", "out"], exit: 0 })
    expect(results.at(0)).toEqual(results.at(1))
  }),
)

it.live("leaves stdin open when endOnDone is false, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(yield* bothSpawners, (subject) =>
      Effect.gen(function* () {
        const handle = yield* subject.spawner.spawn(
          ChildProcess.make("cat", [], { stdin: { stream: Stream.make(encoder.encode("a")), endOnDone: false } }),
        )
        const echoed = yield* firstLine(handle.stdout)
        const isRunning = yield* handle.isRunning
        yield* handle.kill({ killSignal: "SIGKILL" })
        return { echoed, isRunning }
      }),
    )
    expect(results.at(1)).toEqual({ echoed: "a", isRunning: true })
    expect(results.at(0)).toEqual(results.at(1))
  }),
)

it.live("refuses a piped command with a clear cause", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const error = yield* spawner
      .spawn(ChildProcess.pipeTo(ChildProcess.make("echo", ["x"]), ChildProcess.make("cat")))
      .pipe(Effect.flip)
    expect([error.reason._tag, error.message]).toEqual([
      "BadArgument",
      expect.stringContaining("A ren environment does not run piped commands"),
    ])
  }),
)

it.live("says a command is running until it exits, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(yield* bothSpawners, (subject) =>
      Effect.gen(function* () {
        const handle = yield* subject.spawner.spawn(ChildProcess.make("cat", []))
        const before = yield* handle.isRunning
        yield* Stream.make(encoder.encode("x")).pipe(Stream.run(handle.stdin))
        const exit = yield* exitOf(handle)
        return { before, exit, after: yield* handle.isRunning }
      }),
    )
    expect(results.at(1)).toEqual({ before: true, exit: 0, after: false })
    expect(results.at(0)).toEqual(results.at(1))
  }),
)

it.live("stops a command that ignores the signal after the force delay, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(yield* bothSpawners, (subject) =>
      Effect.gen(function* () {
        const handle = yield* subject.spawner.spawn(
          ChildProcess.make("sh", ["-c", "trap '' TERM; echo ready; while :; do sleep 0.1; done"]),
        )
        yield* firstLine(handle.stdout)
        yield* handle.kill({ killSignal: "SIGTERM", forceKillAfter: "300 millis" })
        return { exit: yield* exitOf(handle), isRunning: yield* handle.isRunning }
      }),
    )
    expect(results.at(1)).toEqual({ exit: "failed", isRunning: false })
    expect(results.at(0)).toEqual(results.at(1))
  }),
)

it.live("gives the same exit codes as Effect's spawner, from 0 to 255", () =>
  Effect.gen(function* () {
    const spawners = yield* bothSpawners
    const codes = [0, 1, 2, 42, 126, 127, 128, 129, 200, 255]
    const results = yield* Effect.forEach(spawners, (subject) =>
      Effect.forEach(codes, (code) =>
        subject.spawner.spawn(ChildProcess.make("sh", ["-c", `exit ${code}`])).pipe(Effect.flatMap(exitOf)),
      ),
    )
    expect(results.at(1)).toEqual(codes)
    expect(results.at(0)).toEqual(codes)
  }),
)

it.live("gives a command with no stdin option an open stdin, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(yield* bothSpawners, (subject) =>
      Effect.gen(function* () {
        const handle = yield* subject.spawner.spawn(ChildProcess.make("sh", ["-c", "read line; echo got:$line"]))
        yield* Stream.make(encoder.encode("hi\n")).pipe(Stream.run(handle.stdin))
        return { stdout: yield* text(handle.stdout), exit: yield* exitOf(handle) }
      }),
    )
    expect(results.at(1)).toEqual({ stdout: "got:hi\n", exit: 0 })
    expect(results.at(0)).toEqual(results.at(1))
  }),
)

it.live("gives a command with stdin ignore no input, so cat exits at once, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(yield* bothSpawners, (subject) =>
      Effect.gen(function* () {
        const handle = yield* subject.spawner.spawn(ChildProcess.make("cat", [], { stdin: "ignore" }))
        return { stdout: yield* text(handle.stdout), exit: yield* exitOf(handle) }
      }),
    )
    expect(results.at(1)).toEqual({ stdout: "", exit: 0 })
    expect(results.at(0)).toEqual(results.at(1))
  }),
)

it.live("stops with SIGKILL a command that ignores SIGTERM when its scope closes", () =>
  Effect.gen(function* () {
    const spawner = Hand.spawner(yield* connect, killed)
    const scope = yield* Scope.make()
    const handle = yield* spawner
      .spawn(ChildProcess.make("sh", ["-c", "trap '' TERM; echo ready; while :; do sleep 0.1; done"]))
      .pipe(Scope.provide(scope))
    yield* firstLine(handle.stdout)
    yield* Scope.close(scope, Exit.void)
    expect(yield* Processes.exits(handle.pid)).toBe(true)
  }),
)

const opening = (open: HandAccess.Interface["open"]) =>
  Layer.succeed(HandAccess.Service, HandAccess.Service.of({ open, release: () => Effect.void }))

const isStopped = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  handle.isRunning.pipe(Effect.map((isRunning) => !isRunning))

const heartbeatsInAMinute = Effect.fnUntraced(function* (sandbox: Probe.Probe, connection: HandConnections.Connection) {
  yield* connection.client["executor.hello"]()
  const before = yield* Ref.get(sandbox.heartbeats)
  yield* Probe.advance(Duration.minutes(1))
  yield* connection.client["executor.hello"]()
  return { before, after: yield* Ref.get(sandbox.heartbeats) }
})

const startSandbox = Effect.fnUntraced(function* (options?: Parameters<typeof Probe.make>[0]) {
  const sandbox = yield* Probe.make(options)
  return { sandbox, url: yield* Probe.start({ handId, workspace, executor: sandbox.layer }) }
})

it.effect("a heartbeat that the executor refuses as expired gets a new token, and the command is not stopped", () =>
  Effect.gen(function* () {
    const { sandbox, url } = yield* startSandbox()
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.getAndUpdate(opens, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((issuedAt) =>
                Sandbox.access({
                  url,
                  handId,
                  brain: Brain.ofSession(sessionId),
                  directory: join(workspace, sessionId),
                  issuedAt,
                  lifetimeMs: count === 0 ? 60_000 : 600_000,
                }).pipe(
                  Effect.map((access) =>
                    count === 0 ? { ...access, expiresAt: DateTime.makeUnsafe(issuedAt + 900_000) } : access,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    )
    const connection = yield* environments.connect(sessionId)
    const handle = yield* Hand.spawner(connection, killed).spawn(ChildProcess.make("cat", []))
    yield* Probe.advance(Duration.seconds(55))
    expect(yield* Ref.get(opens)).toBe(1)
    const before = yield* Ref.get(sandbox.heartbeats)
    yield* Probe.advance(Duration.seconds(35))
    expect(yield* Ref.get(opens)).toBe(2)
    expect(yield* Ref.get(sandbox.heartbeats)).toBeGreaterThanOrEqual(before + 4)
    yield* Stream.make(encoder.encode("alive")).pipe(Stream.run(handle.stdin))
    expect(yield* text(handle.stdout)).toBe("alive")
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

it.effect("a command with no output for 2 minutes is not reported as silent, because pings keep the stream open", () =>
  Effect.gen(function* () {
    const { sandbox, url } = yield* startSandbox()
    const link = yield* Probe.link
    const handle = yield* Hand.spawner(yield* connectTo(url, link.layer), killed).spawn(ChildProcess.make("cat", []))
    yield* Probe.advance(Duration.minutes(2))
    expect(yield* Ref.get(sandbox.pings)).toBeGreaterThanOrEqual(20)
    expect((yield* Ref.get(link.requests)).filter((request) => request.rpc === "process.output")).toHaveLength(1)
    yield* Stream.make(encoder.encode("done")).pipe(Stream.run(handle.stdin))
    expect(yield* text(handle.stdout)).toBe("done")
    expect(yield* text(handle.stderr)).toBe("")
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

it.effect(
  "a scope that closes between the spawn request and its answer leaves a command the sandbox stops in 30 seconds",
  () =>
    Effect.gen(function* () {
      const spawned = yield* Deferred.make<SpawnResult>()
      const { url } = yield* startSandbox({
        afterSpawn: (result) => Deferred.succeed(spawned, result).pipe(Effect.andThen(Effect.never)),
      })
      const scope = yield* Scope.make()
      const request = yield* Hand.spawner(yield* connectTo(url), killed)
        .spawn(ChildProcess.make("sleep", ["300"]))
        .pipe(Scope.provide(scope), Effect.forkScoped)
      const command = yield* Deferred.await(spawned)
      expect(Processes.running(command.pid)).toBe(true)
      yield* Fiber.interrupt(request)
      yield* Scope.close(scope, Exit.void)
      yield* Probe.advance(Duration.seconds(30))
      expect(yield* Processes.exits(command.pid)).toBe(true)
    }),
)

it.effect("stops heartbeating when the command exits", () =>
  Effect.gen(function* () {
    const { sandbox, url } = yield* startSandbox()
    const connection = yield* connectTo(url)
    const handle = yield* Hand.spawner(connection, killed).spawn(ChildProcess.make("cat", []))
    yield* Probe.advanceUntil(Ref.get(sandbox.heartbeats).pipe(Effect.map((count) => count >= 3)))
    yield* Stream.make(encoder.encode("x")).pipe(Stream.run(handle.stdin))
    expect(Number(yield* handle.exitCode)).toBe(0)
    const beats = yield* heartbeatsInAMinute(sandbox, connection)
    expect(beats.after).toBe(beats.before)
  }),
)

it.effect("leaves no heartbeat and no output stream after 50 commands have run", () =>
  Effect.gen(function* () {
    const { sandbox, url } = yield* startSandbox()
    const connection = yield* connectTo(url)
    const spawner = Hand.spawner(connection, killed)
    const exits = yield* Effect.forEach(
      Array.from({ length: 50 }, (_, index) => index),
      (index) =>
        spawner
          .spawn(ChildProcess.make("sh", ["-c", `echo ${index}`]))
          .pipe(Effect.flatMap((handle) => Effect.all([text(handle.stdout), exitOf(handle)]))),
      { concurrency: 10 },
    )
    expect(exits.map((result) => result.at(1))).toEqual(Array.from({ length: 50 }, () => 0))
    yield* Probe.advanceUntil(Ref.get(sandbox.outputsOpen).pipe(Effect.map((open) => open === 0)))
    const beats = yield* heartbeatsInAMinute(sandbox, connection)
    expect(beats.after).toBe(beats.before)
    expect(yield* Ref.get(sandbox.outputsOpen)).toBe(0)
  }),
)

it.effect(
  "a command that waits on an open stdin and is interrupted leaves no process, output stream or heartbeat",
  () =>
    Effect.gen(function* () {
      const { sandbox, url } = yield* startSandbox()
      const connection = yield* connectTo(url)
      const started = yield* Deferred.make<number>()
      const run = Hand.spawner(connection, killed)
        .spawn(ChildProcess.make("cat", []))
        .pipe(
          Effect.flatMap((handle) =>
            Deferred.succeed(started, Number(handle.pid)).pipe(Effect.andThen(handle.exitCode)),
          ),
          Effect.scoped,
        )
      const fiber = yield* Effect.forkScoped(run)
      const pid = yield* Deferred.await(started)
      yield* Probe.advanceUntil(Ref.get(sandbox.outputsOpen).pipe(Effect.map((open) => open === 1)))
      yield* Fiber.interrupt(fiber)
      expect(yield* Processes.exits(pid)).toBe(true)
      yield* Probe.advanceUntil(Ref.get(sandbox.outputsOpen).pipe(Effect.map((open) => open === 0)))
      const beats = yield* heartbeatsInAMinute(sandbox, connection)
      expect(beats.after).toBe(beats.before)
    }),
)

const lossy = Effect.fnUntraced(function* (command: ChildProcess.Command) {
  const { sandbox, url } = yield* startSandbox()
  const relay = yield* Relay.make(Relay.portOf(url))
  const link = yield* Probe.link
  const handle = yield* Hand.spawner(yield* connectTo(relay.url, link.layer), killed).spawn(command)
  yield* Probe.advanceUntil(
    Effect.zipWith(
      Ref.get(sandbox.pings),
      Ref.get(sandbox.heartbeats),
      (pings, heartbeats) => pings >= 1 && heartbeats >= 2,
    ),
  )
  return {
    sandbox,
    relay,
    link,
    handle,
    lose: Ref.set(link.down, true).pipe(Effect.andThen(relay.cut)),
    restore: Ref.set(link.down, false),
  }
})

const disconnected = "[hand disconnected: the command did not finish]"

it.effect(
  "a connection lost for 25 seconds comes back and the command lives, and one lost for 35 seconds ends with a notice",
  () =>
    Effect.gen(function* () {
      const short = yield* lossy(ChildProcess.make("cat", []))
      yield* short.lose
      yield* Probe.advance(Duration.seconds(25))
      yield* short.restore
      yield* Probe.advanceUntil(Ref.get(short.sandbox.outputsOpen).pipe(Effect.map((open) => open === 1)))
      yield* Stream.make(encoder.encode("alive")).pipe(Stream.run(short.handle.stdin))
      expect(yield* text(short.handle.stdout)).toBe("alive")
      expect(yield* text(short.handle.stderr)).toBe("")
      expect(Number(yield* short.handle.exitCode)).toBe(0)

      const long = yield* lossy(ChildProcess.make("cat", []))
      yield* long.lose
      yield* Probe.advance(Duration.seconds(35))
      yield* long.handle.exitCode.pipe(Effect.flip)
      expect(yield* text(long.handle.stderr)).toContain(disconnected)
      expect(yield* Processes.exits(long.handle.pid)).toBe(true)
    }),
)

it.effect("tries to reconnect once a second for 30 seconds, and no faster", () =>
  Effect.gen(function* () {
    const lost = yield* lossy(ChildProcess.make("cat", []))
    yield* lost.lose
    yield* Probe.advanceUntil(isStopped(lost.handle), Duration.minutes(2))
    const tries = (yield* Ref.get(lost.link.requests)).filter(
      (request) => request.rpc === "process.output" && request.refused,
    )
    expect(tries.length).toBeGreaterThanOrEqual(25)
    expect(tries.length).toBeLessThanOrEqual(31)
    expect(tries.slice(1).every((request, index) => request.atMs - (tries.at(index)?.atMs ?? 0) >= 1_000)).toBe(true)
  }),
)

it.effect(
  "a stream that goes silent is dropped after 15 seconds, then tried again until 30 seconds, then ends with a notice",
  () =>
    Effect.gen(function* () {
      const lost = yield* lossy(ChildProcess.make("cat", []))
      const tries = Ref.get(lost.link.requests).pipe(
        Effect.map((all) => all.filter((request) => request.rpc === "process.output" && request.refused).length),
      )
      const frozenAt = yield* Clock.currentTimeMillis
      yield* lost.relay.freeze
      yield* Ref.set(lost.link.down, true)
      yield* Probe.advance(Duration.seconds(12))
      expect(yield* tries).toBe(0)
      yield* Probe.advance(Duration.seconds(6))
      expect(yield* tries).toBeGreaterThan(0)
      yield* Probe.advanceUntil(isStopped(lost.handle), Duration.minutes(2))
      expect((yield* Clock.currentTimeMillis) - frozenAt).toBeLessThanOrEqual(40_000)
      yield* lost.handle.exitCode.pipe(Effect.flip)
      expect(yield* text(lost.handle.stderr)).toContain(disconnected)
    }),
)

it.effect("a command that exits while the connection is lost gives its exit when the connection comes back", () =>
  Effect.gen(function* () {
    const flag = join(workspace, `flag-${sessionId}`)
    const lost = yield* lossy(
      ChildProcess.make("sh", ["-c", `echo ready; while [ ! -e ${flag} ]; do sleep 0.05; done; echo bye; exit 3`]),
    )
    yield* lost.lose
    yield* Probe.advance(Duration.seconds(10))
    yield* Effect.promise(() => writeFile(flag, ""))
    expect(yield* Processes.exits(lost.handle.pid)).toBe(true)
    yield* Probe.advance(Duration.seconds(10))
    yield* lost.restore
    yield* Probe.advanceUntil(isStopped(lost.handle), Duration.minutes(1))
    expect(yield* text(lost.handle.stdout)).toBe("ready\nbye\n")
    expect(yield* text(lost.handle.stderr)).toBe("")
    expect(Number(yield* lost.handle.exitCode)).toBe(3)
  }),
)

it.effect(
  "a heartbeat for a command the sandbox no longer knows, or one that races a stop, gives the caller no error",
  () =>
    Effect.gen(function* () {
      const relay = yield* Relay.make(Relay.portOf(yield* Probe.start({ handId, workspace })))
      const link = yield* Probe.link
      const spawner = Hand.spawner(yield* connectTo(relay.url, link.layer), killed)
      const forgotten = yield* spawner.spawn(ChildProcess.make("cat", []))
      yield* relay.target(Relay.portOf(yield* Probe.start({ handId, workspace })))
      yield* relay.cut
      const heartbeats = Ref.get(link.requests).pipe(
        Effect.map((all) => all.filter((request) => request.rpc === "process.heartbeat").length),
      )
      const before = yield* heartbeats
      yield* Probe.advanceUntil(isStopped(forgotten))
      yield* Probe.advance(Duration.seconds(15))
      expect(yield* heartbeats).toBeGreaterThanOrEqual(before + 2)
      expect(yield* text(forgotten.stderr)).toBe(`\n${disconnected}\n`)
      const racing = yield* spawner.spawn(ChildProcess.make("cat", []))
      yield* TestClock.adjust(Duration.seconds(3))
      yield* Effect.all([TestClock.adjust(Duration.seconds(2)), racing.kill({ killSignal: "SIGKILL" })], {
        concurrency: "unbounded",
      })
      const error = yield* racing.exitCode.pipe(Effect.flip)
      expect(error.cause instanceof Killed && error.cause.signal).toBe("SIGKILL")
      expect(yield* text(racing.stderr)).toBe("")
    }),
)
