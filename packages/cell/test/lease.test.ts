import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { Lease } from "../src/lease.js"

const host = (
  options: { readonly opening?: Deferred.Deferred<void>; readonly closing?: Deferred.Deferred<void> } = {},
) => {
  const state: { opened: number; closed: Array<number> } = { opened: 0, closed: [] }
  return {
    state,
    lease: Lease.make(
      Effect.sync(() => (state.opened += 1)).pipe(
        Effect.tap(() => (options.opening ? Deferred.await(options.opening) : Effect.void)),
      ),
      (value) =>
        (options.closing ? Deferred.await(options.closing) : Effect.void).pipe(
          Effect.andThen(
            Effect.sync(() => {
              state.closed.push(value)
            }),
          ),
        ),
    ),
  }
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("host leases", () => {
  test("failed disposal fails waiting and future leases without opening a second host", () =>
    run(
      Effect.gen(function* () {
        const closing = yield* Deferred.make<void>()
        const state = { opens: 0 }
        const failure = new Error("dispose failed")
        const lease = Lease.make(
          Effect.sync(() => ++state.opens),
          () => Deferred.await(closing).pipe(Effect.andThen(Effect.die(failure))),
        )
        yield* Effect.scoped(lease.acquire)
        const closed = yield* Effect.forkChild(Effect.exit(lease.close))
        yield* Effect.yieldNow
        const waiting = yield* Effect.forkChild(Effect.exit(Effect.scoped(lease.acquire)))
        yield* Effect.yieldNow
        yield* Deferred.succeed(closing, undefined)
        expect(yield* Fiber.join(closed)).toEqual(Exit.die(failure))
        expect(yield* Fiber.join(waiting)).toEqual(Exit.die(failure))
        expect(yield* Effect.exit(Effect.scoped(lease.acquire))).toEqual(Exit.die(failure))
        expect(state.opens).toBe(1)
        expect(lease.state().leases).toBe(0)
      }),
    ))

  test("the first lease opens the host and later leases reuse it", () =>
    run(
      Effect.gen(function* () {
        const opened = host()
        expect(opened.lease.state()).toEqual({ open: false, leases: 0 })
        expect(yield* Effect.scoped(opened.lease.acquire)).toBe(1)
        expect(yield* Effect.scoped(Effect.all([opened.lease.acquire, opened.lease.acquire]))).toEqual([1, 1])
        expect(opened.state.opened).toBe(1)
        expect(opened.lease.state()).toEqual({ open: true, leases: 0 })
      }),
    ))

  test("leases taken while the host is opening share one open", () =>
    run(
      Effect.gen(function* () {
        const opening = yield* Deferred.make<void>()
        const opened = host({ opening })
        const leases = yield* Effect.forkChild(
          Effect.scoped(
            Effect.all([opened.lease.acquire, opened.lease.acquire, opened.lease.acquire], { concurrency: 3 }),
          ),
        )
        yield* Effect.yieldNow
        expect(opened.lease.state()).toEqual({ open: true, leases: 3 })
        yield* Deferred.succeed(opening, undefined)
        expect(yield* Fiber.join(leases)).toEqual([1, 1, 1])
        expect(opened.state.opened).toBe(1)
      }),
    ))

  test("a failed open is not kept: every waiting lease fails and the next lease opens again", () =>
    run(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const state = { attempts: 0 }
        const lease = Lease.make(
          Effect.suspend(() => {
            state.attempts += 1
            return state.attempts === 1
              ? Deferred.await(gate).pipe(Effect.andThen(Effect.fail("down")))
              : Effect.succeed(state.attempts)
          }),
          () => Effect.void,
        )
        const waiting = yield* Effect.forkChild(
          Effect.all([Effect.exit(Effect.scoped(lease.acquire)), Effect.exit(Effect.scoped(lease.acquire))], {
            concurrency: 2,
          }),
        )
        yield* Effect.yieldNow
        yield* Deferred.succeed(gate, undefined)
        expect(yield* Fiber.join(waiting)).toEqual([Exit.fail("down"), Exit.fail("down")])
        expect(lease.state()).toEqual({ open: false, leases: 0 })
        expect(yield* Effect.scoped(lease.acquire)).toBe(2)
      }),
    ))

  test("releasing a lease lowers the count, and releasing it twice changes nothing", () =>
    run(
      Effect.gen(function* () {
        const opened = host()
        const first = yield* Scope.make()
        const second = yield* Scope.make()
        yield* opened.lease.acquire.pipe(Scope.provide(first))
        yield* opened.lease.acquire.pipe(Scope.provide(second))
        expect(opened.lease.state().leases).toBe(2)
        yield* Scope.close(first, Exit.void)
        yield* Scope.close(first, Exit.void)
        expect(opened.lease.state().leases).toBe(1)
        yield* Scope.close(second, Exit.void)
        expect(opened.lease.state().leases).toBe(0)
      }),
    ))

  test("a lease is released when the work it guards fails or is interrupted", () =>
    run(
      Effect.gen(function* () {
        const opened = host()
        const failed = yield* Effect.exit(Effect.scoped(opened.lease.acquire.pipe(Effect.andThen(Effect.fail("boom")))))
        expect(failed).toEqual(Exit.fail("boom"))
        expect(opened.lease.state().leases).toBe(0)
        const held = yield* Effect.forkChild(Effect.scoped(opened.lease.acquire.pipe(Effect.andThen(Effect.never))))
        yield* Effect.yieldNow
        expect(opened.lease.state().leases).toBe(1)
        yield* Fiber.interrupt(held)
        expect(opened.lease.state().leases).toBe(0)
      }),
    ))

  test("close does nothing while a lease is held, and closes the host once the lease is released", () =>
    run(
      Effect.gen(function* () {
        const opened = host()
        const scope = yield* Scope.make()
        yield* opened.lease.acquire.pipe(Scope.provide(scope))
        yield* opened.lease.close
        expect({ closed: opened.state.closed, state: opened.lease.state() }).toEqual({
          closed: [],
          state: { open: true, leases: 1 },
        })
        yield* Scope.close(scope, Exit.void)
        yield* opened.lease.close
        expect({ closed: opened.state.closed, state: opened.lease.state() }).toEqual({
          closed: [1],
          state: { open: false, leases: 0 },
        })
      }),
    ))

  test("close does nothing when the host is not open", () =>
    run(
      Effect.gen(function* () {
        const opened = host()
        yield* opened.lease.close
        yield* Effect.scoped(opened.lease.acquire)
        yield* opened.lease.close
        yield* opened.lease.close
        expect(opened.state.closed).toEqual([1])
      }),
    ))

  test("a lease taken while the host closes waits for the close, then opens a new host", () =>
    run(
      Effect.gen(function* () {
        const closing = yield* Deferred.make<void>()
        const opened = host({ closing })
        yield* Effect.scoped(opened.lease.acquire)
        const closed = yield* Effect.forkChild(opened.lease.close)
        yield* Effect.yieldNow
        const next = yield* Effect.forkChild(Effect.scoped(opened.lease.acquire))
        yield* Effect.yieldNow
        expect({ opened: opened.state.opened, closed: opened.state.closed }).toEqual({ opened: 1, closed: [] })
        yield* Deferred.succeed(closing, undefined)
        yield* Fiber.join(closed)
        expect(yield* Fiber.join(next)).toBe(2)
        expect(opened.state.closed).toEqual([1])
      }),
    ))
})
