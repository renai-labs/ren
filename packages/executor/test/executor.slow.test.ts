import { expect } from "bun:test"
import { Brain } from "@ren/schema/brain"
import { Effect, Stream } from "effect"
import { Executor } from "../src/executor.js"
import { testEffect } from "./lib/effect.js"
import { Processes } from "./lib/process.js"
import { TestSandbox } from "./lib/sandbox.js"

const it = testEffect(TestSandbox.layer)
const brain = TestSandbox.brain
const decoder = TestSandbox.decoder
const mebibyte = TestSandbox.mebibyte
const run = TestSandbox.run
const bytesOf = TestSandbox.bytesOf
const collect = TestSandbox.collect

it.live("holds a process back for a slow reader rather than drop output it has not read", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "head", arguments: ["-c", "5000000", "/dev/zero"] })
    const size = yield* process.events.pipe(
      Stream.tap(() => Effect.sleep(5)),
      Stream.runFold(
        () => 0,
        (total, event) => total + (event.type === "stdout" ? event.bytes.length : 0),
      ),
    )
    expect(size).toBe(5_000_000)
  }),
)

it.live(
  "completes 200 commands from 10 brains at the same time, and gives back its file descriptors",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      const start = Processes.openFiles()
      const commands = Array.from({ length: 10 }, () => Brain.ID.create()).flatMap((owner, index) =>
        Array.from({ length: 20 }, (_, count) => ({ owner, number: index * 20 + count })),
      )
      const outputs = yield* Effect.forEach(
        commands,
        (command) =>
          Effect.gen(function* () {
            const spawned = yield* executor.spawn(command.owner, {
              command: "sh",
              arguments: ["-c", `sleep 0.2; echo ${command.number}`],
            })
            return yield* collect(yield* executor.output(command.owner, spawned.id))
          }),
        { concurrency: "unbounded" },
      )
      expect(outputs).toEqual(
        commands.map((command) => ({
          stdout: `${command.number}\n`,
          stderr: "",
          exit: { type: "exit", exitCode: 0, signal: null },
        })),
      )
      expect(Processes.openFiles()).toBe(start)
    }),
  30_000,
)

it.live("streams 50 MB to a reader and keeps only the last 2 MiB of it", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    Bun.gc(true)
    const before = process.memoryUsage().arrayBuffers
    const spawned = yield* executor.spawn(brain, { command: "sh", arguments: ["-c", "yes | head -c 52428800"] })
    const received = yield* (yield* executor.output(brain, spawned.id)).pipe(
      Stream.runFold(
        () => 0,
        (total, event) => total + (event.type === "stdout" ? event.bytes.length : 0),
      ),
    )
    expect(received).toBe(50 * mebibyte)
    Bun.gc(true)
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(3 * mebibyte)
  }),
)

it.live("gives output with no new line, with only carriage returns, and one line of 10 MiB as it is", () =>
  Effect.gen(function* () {
    const output = Effect.fnUntraced(function* (script: string) {
      const process = yield* run({ command: "sh", arguments: ["-c", script] })
      return bytesOf([...(yield* Stream.runCollect(process.events))], "stdout")
    })
    expect(decoder.decode(yield* output("printf abc"))).toBe("abc")
    expect(decoder.decode(yield* output("printf 'a\\rb\\rc\\r'"))).toBe("a\rb\rc\r")
    const line = yield* output("head -c 10485760 /dev/zero | tr '\\0' a")
    expect(line.length).toBe(10 * mebibyte)
    expect(line).toEqual(new Uint8Array(10 * mebibyte).fill(97))
  }),
)
