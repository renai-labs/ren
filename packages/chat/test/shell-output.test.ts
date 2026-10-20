import { describe, expect, test } from "bun:test"
import type { Shell } from "@ren/schema/shell"
import { Effect, Fiber, Option, Queue, type Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { ShellOutput } from "../src/shell-output.js"

const run = (body: () => Effect.Effect<void, never, Scope.Scope>) =>
  body().pipe(Effect.scoped, Effect.provide(TestClock.layer()), Effect.runPromise)

const server = (text: () => string, page = Infinity) => {
  const cursors: Array<number> = []
  return {
    cursors,
    load: (cursor: number) =>
      Effect.sync((): Option.Option<Shell.Output> => {
        cursors.push(cursor)
        const full = text()
        const output = full.slice(cursor, cursor + page)
        return Option.some({ output, cursor: cursor + output.length, size: full.length, truncated: false })
      }),
  }
}

const watch = (stream: Stream.Stream<string>) =>
  Effect.gen(function* () {
    const outputs = yield* Queue.unbounded<string>()
    const fiber = yield* stream.pipe(
      Stream.runForEach((output) => Queue.offer(outputs, output)),
      Effect.forkScoped,
    )
    return { next: Queue.take(outputs), fiber }
  })

describe("followShellOutput", () => {
  test("stops polling a missing shell and never requests it again", () =>
    run(() =>
      Effect.gen(function* () {
        const shells = ShellOutput.make()
        const cursors: Array<number> = []
        const follow = () =>
          shells.follow({
            id: "sh_missing",
            running: true,
            load: (cursor) =>
              Effect.sync(() => {
                cursors.push(cursor)
                return Option.none<Shell.Output>()
              }),
          })
        yield* Stream.runDrain(follow())
        expect(cursors).toEqual([0])
        yield* TestClock.adjust("10 seconds")
        expect(cursors).toEqual([0])
        const remounted = yield* follow().pipe(Stream.runCollect, Effect.forkScoped)
        yield* TestClock.adjust("10 seconds")
        expect(yield* Fiber.join(remounted)).toEqual([""])
        expect(cursors).toEqual([0])
      }),
    ))

  test("polls a running shell once per second and resumes from the cached cursor after a remount", () =>
    run(() =>
      Effect.gen(function* () {
        const shells = ShellOutput.make()
        const state = { text: "hello\n" }
        const shell = server(() => state.text)
        const follow = (running: boolean) => shells.follow({ id: "sh_live", running, load: shell.load })

        const first = yield* watch(follow(true))
        expect(yield* first.next).toBe("hello\n")
        state.text += "world\n"
        yield* TestClock.adjust("1 second")
        expect(yield* first.next).toBe("hello\nworld\n")
        expect(shell.cursors).toEqual([0, 6])

        yield* Fiber.interrupt(first.fiber)
        state.text += "done\n"
        const second = yield* watch(follow(true))
        expect(yield* second.next).toBe("hello\nworld\n")
        expect(yield* second.next).toBe("hello\nworld\ndone\n")
        expect(shell.cursors).toEqual([0, 6, 12])

        yield* Fiber.interrupt(second.fiber)
        yield* Stream.runDrain(follow(false))
        expect(shell.cursors).toEqual([0, 6, 12, 17])

        expect(yield* Stream.runCollect(follow(false))).toEqual(["hello\nworld\ndone\n"])
        expect(shell.cursors).toEqual([0, 6, 12, 17])

        const late = yield* watch(follow(true))
        yield* late.next
        yield* late.next
        yield* Fiber.interrupt(late.fiber)
        expect(shell.cursors).toEqual([0, 6, 12, 17, 17])
      }),
    ))

  test("keeps only the most recent tail of a large output", () =>
    run(() =>
      Effect.gen(function* () {
        const shell = server(() => `${"a".repeat(ShellOutput.tailBytes)}tail`, ShellOutput.tailBytes)
        const outputs = yield* Stream.runCollect(
          ShellOutput.make().follow({ id: "sh_large", running: false, load: shell.load }),
        )
        expect(shell.cursors).toEqual([0, ShellOutput.tailBytes])
        expect(outputs.at(-1)?.length).toBe(ShellOutput.tailBytes)
        expect(outputs.at(-1)?.endsWith(`${"a".repeat(8)}tail`)).toBe(true)
      }),
    ))
})
