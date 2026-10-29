export * as Fence from "./fence.js"

import { Context, Deferred, Effect, Layer } from "effect"

export interface Interface {
  readonly retired: Deferred.Deferred<string>
  readonly retire: (reason: string) => Effect.Effect<void>
  readonly isRetired: Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Fence") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const retired = yield* Deferred.make<string>()
    return Service.of({
      retired,
      retire: (reason) =>
        Effect.logError("Ren retired this brain's generation; the brain fences itself").pipe(
          Effect.annotateLogs({ reason }),
          Effect.andThen(Deferred.succeed(retired, reason)),
          Effect.asVoid,
        ),
      isRetired: Deferred.isDone(retired),
    })
  }),
)
