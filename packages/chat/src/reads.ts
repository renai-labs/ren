export * as Reads from "./reads.js"

import { Deferred, Effect, Exit, type Scope } from "effect"

interface Pending<E> {
  readonly done: Deferred.Deferred<void, E>
  invalidated: boolean
  started: boolean
}

export interface Reads<E> {
  readonly run: (key: string, load: Effect.Effect<void, E>) => Effect.Effect<void, E>
  readonly complete: (key: string) => void
  readonly has: (key: string) => boolean
  readonly pending: (key: string) => boolean
  readonly invalidate: (key?: string) => void
}

export const make = <E>(): Effect.Effect<Reads<E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const state = new Map<string, true | Pending<E>>()

    const start = (key: string, load: Effect.Effect<void, E>, wait?: Deferred.Deferred<void, E>) =>
      Effect.gen(function* () {
        const entry: Pending<E> = { done: Deferred.makeUnsafe<void, E>(), invalidated: false, started: !wait }
        state.set(key, entry)
        yield* Effect.gen(function* () {
          if (wait) yield* Effect.exit(Deferred.await(wait))
          entry.started = true
          const exit = yield* Effect.exit(load)
          if (Exit.isSuccess(exit) && state.get(key) === entry && !entry.invalidated) state.set(key, true)
          else if (state.get(key) === entry) state.delete(key)
          yield* Deferred.done(entry.done, exit)
        }).pipe(
          Effect.onInterrupt(() => Deferred.interrupt(entry.done)),
          Effect.forkIn(scope),
        )
        return yield* Deferred.await(entry.done)
      })

    return {
      run: (key, load) =>
        Effect.suspend(() => {
          const active = state.get(key)
          if (active === true) return Effect.void
          if (!active) return start(key, load)
          if (!active.invalidated) return Deferred.await(active.done)
          return start(key, load, active.done)
        }),
      complete: (key) => {
        if (!state.has(key)) state.set(key, true)
      },
      has: (key) => state.has(key),
      pending: (key) => {
        const active = state.get(key)
        return typeof active === "object"
      },
      invalidate: (key) => {
        const invalidate = (active: true | Pending<E>, current: string) => {
          if (active === true) state.delete(current)
          else if (active.started) active.invalidated = true
        }
        const targets = key ? [[key, state.get(key)] as const] : [...state]
        for (const [current, active] of targets) if (active) invalidate(active, current)
      },
    }
  })
