import { expect, test } from "bun:test"
import { Machine, Processes, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Exit, Layer, Schedule, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EnvironmentAccess } from "../src/environment-access.js"
import { Environments } from "../src/environments.js"
import { Hand } from "../src/hand.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-hand-")))
const it = testEffect(Machine.layer({ environmentId, workspace }))

class Killed extends Error {
  constructor(readonly signal: string) {
    super(`Killed by ${signal}`)
  }
}

const killed = (signal: string) => new Killed(signal)

const sessionId = Session.ID.create()

const accessAt = (url: string) =>
  Machine.access({ url, environmentId, brain: Brain.ofSession(sessionId), directory: join(workspace, sessionId) })

const environmentsWith = (access: Layer.Layer<EnvironmentAccess.Service>) =>
  Layer.build(Environments.layer.pipe(Layer.provide(access), Layer.provide(FetchHttpClient.layer))).pipe(
    Effect.map((context) => Context.get(context, Environments.Service)),
  )

const connectTo = Effect.fnUntraced(function* (url: string) {
  const environments = yield* environmentsWith(EnvironmentAccess.layerFixed(new Map([[sessionId, yield* accessAt(url)]])))
  return yield* environments.connect(sessionId, "processes")
})

const connect = Effect.flatMap(Machine.url, connectTo)

const throughRelay = Effect.gen(function* () {
  const relay = yield* Relay.make(Relay.portOf(yield* Machine.url))
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
      ChildProcess.make("sh", ["-c", "sleep 0.3; wc -c"], { stdin: Stream.make(...Array.from({ length: 40 }, () => chunk)) }),
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
    const restarted = yield* Layer.build(Layer.fresh(Machine.layer({ environmentId, workspace }))).pipe(
      Effect.flatMap((context) => Effect.provide(Machine.url, context)),
    )
    const handle = yield* through.spawner.spawn(ChildProcess.make("sh", ["-c", "echo started; sleep 30"]))
    yield* firstLine(handle.stdout)
    yield* through.relay.target(Relay.portOf(restarted))
    yield* through.relay.cut
    yield* handle.exitCode.pipe(Effect.flip, Effect.timeout(10_000))
    expect(yield* text(handle.stderr)).toContain("[environment disconnected: the command did not finish]")
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
    expect(yield* text(handle.stderr)).toMatch(/\[environment reconnected: \d+ bytes of output were lost\]/)
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

test.each([
  { from: "/workspace", to: "/home/ren/project", path: "/workspace", expected: "/home/ren/project" },
  { from: "/workspace", to: "/home/ren/project", path: "/workspace/src/a.ts", expected: "/home/ren/project/src/a.ts" },
  { from: "/workspace", to: "/home/ren/project", path: "/workspaces/other", expected: "/workspaces/other" },
  { from: "/workspace", to: "/home/ren/project", path: "/tmp/out", expected: "/tmp/out" },
  { from: "/workspace", to: "/home/ren/project", path: "relative/a.ts", expected: "relative/a.ts" },
  { from: "/workspace/", to: "/home/ren/project", path: "/workspace", expected: "/home/ren/project" },
  { from: "/workspace/", to: "/home/ren/project", path: "/workspace/src/a.ts", expected: "/home/ren/project/src/a.ts" },
  { from: "/workspace", to: "/home/ren/project/", path: "/workspace", expected: "/home/ren/project" },
  { from: "/workspace", to: "/home/ren/project/", path: "/workspace/a.ts", expected: "/home/ren/project/a.ts" },
  { from: "/", to: "/home/ren/project", path: "/", expected: "/home/ren/project" },
  { from: "/", to: "/home/ren/project", path: "/a.ts", expected: "/home/ren/project/a.ts" },
  { from: "/workspace", to: "/", path: "/workspace", expected: "/" },
  { from: "/workspace", to: "/", path: "/workspace/a.ts", expected: "/a.ts" },
])("maps $path from $from onto $to", (row) => {
  expect(Hand.physicalPath(row.from, row.to)(row.path)).toBe(row.expected)
})

const replaceable = Effect.gen(function* () {
  const access = yield* accessAt(yield* Machine.url)
  const context = yield* Layer.build(EnvironmentAccess.layerMemory(new Map([[sessionId, access]])))
  const environments = yield* environmentsWith(Layer.succeedContext(context))
  const original = yield* Effect.scoped(environments.connect(sessionId, "processes"))
  const replacement = yield* Scope.make()
  const next = yield* Layer.buildWithScope(Layer.fresh(Machine.layer({ environmentId, workspace })), replacement).pipe(
    Effect.flatMap((built) => Effect.provide(Machine.url, built)),
  )
  return {
    hand: Hand.session(environments, sessionId, Environment.sessionDirectory(sessionId), killed),
    replace: Context.get(context, EnvironmentAccess.Memory)
      .set(sessionId, { ...access, url: next, generation: 2 })
      .pipe(
        Effect.andThen(
          Effect.scoped(environments.connect(sessionId, "processes")).pipe(
            Effect.repeat({ until: (current) => current !== original, schedule: Schedule.spaced(10) }),
            Effect.timeout(5_000),
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
