export * as Lease from "./lease.js"

import { Deferred, Effect, Exit } from "effect"

interface State<A, E> {
  leases: number
  current: Deferred.Deferred<A, E> | undefined
  closing: Deferred.Deferred<void> | undefined
}

export const make = <A, E>(open: Effect.Effect<A, E>, close: (value: A) => Effect.Effect<void>) => {
  const state: State<A, E> = { leases: 0, current: undefined, closing: undefined }
  return {
    state: () => ({ open: Boolean(state.current), leases: state.leases }),
    acquire: Effect.gen(function* () {
      state.leases += 1
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          state.leases -= 1
        }),
      )
      if (state.closing) yield* Deferred.await(state.closing)
      const current = state.current
      if (current) return yield* Deferred.await(current)
      const opening = Deferred.makeUnsafe<A, E>()
      state.current = opening
      const exit = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const opened = yield* Effect.exit(open)
          if (Exit.isFailure(opened)) state.current = undefined
          yield* Deferred.done(opening, opened)
          return opened
        }),
      )
      return yield* exit
    }),
    close: Effect.uninterruptible(
      Effect.gen(function* () {
        const current = state.current
        if (state.leases > 0 || !current) return
        const closing = Deferred.makeUnsafe<void>()
        state.current = undefined
        state.closing = closing
        const opened = yield* Effect.exit(Deferred.await(current))
        const closed = yield* Effect.exit(Exit.isSuccess(opened) ? close(opened.value) : Effect.void)
        if (Exit.isSuccess(closed)) state.closing = undefined
        yield* Deferred.done(closing, closed)
        yield* closed
      }),
    ),
  }
}
