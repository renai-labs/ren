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
    const state = { active: 0, pending: new Map<string, Effect.Effect<void>>() }
    const flush = Effect.suspend(() => {
      if (state.active > 0) return Effect.void
      const pending = [...state.pending.values()]
      state.pending.clear()
      return Effect.forEach(pending, (work) => work, { discard: true })
    })
    const boundary: Boundary = {
      run: (work) =>
        Effect.uninterruptibleMask((restore) =>
          restore(gate.withPermit(Effect.sync(() => void (state.active += 1)))).pipe(
            Effect.andThen(
              restore(work).pipe(
                Effect.ensuring(
                  gate.withPermit(Effect.sync(() => void (state.active -= 1)).pipe(Effect.andThen(flush))),
                ),
              ),
            ),
          ),
        ),
      offer: (key, work) =>
        gate.withPermit(Effect.sync(() => void state.pending.set(key, work)).pipe(Effect.andThen(flush))),
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
            return SessionRunner.Service.of({ drain: (input) => boundary.run(runner.drain(input)) })
          }),
        ),
      }),
    ),
  }
}

export interface Boundary {
  readonly run: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly offer: (key: string, work: Effect.Effect<void>) => Effect.Effect<void>
}
