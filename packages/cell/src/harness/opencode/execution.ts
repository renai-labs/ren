export * as OpenCodeExecution from "./execution.js"

import { Location } from "@opencode/core/location"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionRunnerLLM } from "@opencode/core/session/runner/llm"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Deferred, Effect, Layer } from "effect"

export const make = (): {
  readonly get: (location: { readonly directory: string; readonly workspaceID?: string | undefined }) => Boundary
  readonly replacement: LayerNode.Replacement
} => {
  const locations = new Map<string, Boundary>()
  const get = (location: { readonly directory: string; readonly workspaceID?: string | undefined }) => {
    const key = JSON.stringify([location.directory, location.workspaceID])
    const existing = locations.get(key)
    if (existing) return existing
    const holds = new Set<Deferred.Deferred<void>>()
    const boundary: Boundary = {
      run: (work) => Effect.forEach([...holds], Deferred.await, { discard: true }).pipe(Effect.andThen(work)),
      holdUntil: (work) =>
        Effect.gen(function* () {
          const done = yield* Deferred.make<void>()
          holds.add(done)
          yield* work.pipe(
            Effect.catchCause((cause) => Effect.logError(`The boot work for ${location.directory} failed`, cause)),
            Effect.ensuring(
              Effect.sync(() => holds.delete(done)).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
            ),
          )
        }),
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

// oxlint-disable-next-line ren/no-comments -- HR1, HR19: a change applies at once; only a drain that starts while boot work runs (the first wait for app MCP servers) waits for it.
export interface Boundary {
  readonly run: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly holdUntil: (work: Effect.Effect<void>) => Effect.Effect<void>
}
