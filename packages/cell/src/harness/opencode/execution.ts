export * as OpenCodeExecution from "./execution.js"

import { Location } from "@opencode/core/location"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionRunnerLLM } from "@opencode/core/session/runner/llm"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Semaphore } from "effect"

export const make = (): {
  readonly get: (location: { readonly directory: string; readonly workspaceID?: string | undefined }) => Boundary
  readonly replacement: LayerNode.Replacement
} => {
  const locations = new Map<string, Boundary>()
  const get = (location: { readonly directory: string; readonly workspaceID?: string | undefined }) => {
    const key = JSON.stringify([location.directory, location.workspaceID])
    const existing = locations.get(key)
    if (existing) return existing
    const gate = Semaphore.makeUnsafe(1)
    const state: {
      active: number
      pending: Effect.Effect<void> | undefined
      idle: Array<Effect.Effect<void>>
    } = { active: 0, pending: undefined, idle: [] }
    const flush = Effect.suspend(() => {
      if (state.active > 0) return Effect.void
      const work = [...(state.pending ? [state.pending] : []), ...state.idle.splice(0)]
      state.pending = undefined
      return Effect.forEach(
        work,
        (each) =>
          each.pipe(
            Effect.catchCause((cause) => Effect.logError(`The pending update for ${location.directory} failed`, cause)),
          ),
        { discard: true },
      )
    })
    const boundary: Boundary = {
      run: (work) =>
        Effect.suspend(() => {
          let admitted = false
          const admit = gate.withPermit(
            Effect.sync(() => {
              state.active += 1
              admitted = true
            }),
          )
          const release = gate.withPermit(
            Effect.sync(() => {
              if (!admitted) return
              state.active -= 1
              admitted = false
            }).pipe(Effect.andThen(flush)),
          )
          return Effect.uninterruptibleMask((restore) =>
            restore(admit).pipe(
              Effect.andThen(restore(work)),
              Effect.ensuring(Effect.suspend(() => (admitted ? release : Effect.void))),
            ),
          )
        }),
      offer: (work) =>
        gate.withPermit(
          Effect.sync(() => {
            state.pending = work
          }).pipe(Effect.andThen(flush)),
        ),
      idle: (work) =>
        gate.withPermit(
          Effect.sync(() => {
            state.idle.push(work)
          }).pipe(Effect.andThen(flush)),
        ),
    }
    locations.set(key, boundary)
    return boundary
  }
  return {
    get,
    replacement: SessionRunnerLLM.node.replace(
      LayerNode.make({
        service: SessionRunner.Service,
        tag: SessionRunnerLLM.node.tag,
        deps: [SessionRunnerLLM.node.mapLayer((layer) => layer), Location.node],
        layer: Layer.effect(
          SessionRunner.Service,
          Effect.gen(function* () {
            const runner = yield* SessionRunner.Service
            const location = yield* Location.Service
            const boundary = get(location)
            return SessionRunner.Service.of({
              drain: (input) => boundary.run(runner.drain(input)),
            })
          }),
        ),
      }),
    ),
  }
}

// oxlint-disable-next-line ren/no-comments -- `offer` keeps only the latest update; `idle` runs each work once, after the update, when no turn is running.
export interface Boundary {
  readonly run: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly offer: (work: Effect.Effect<void>) => Effect.Effect<void>
  readonly idle: (work: Effect.Effect<void>) => Effect.Effect<void>
}
