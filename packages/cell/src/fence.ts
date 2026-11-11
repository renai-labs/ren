export * as Fence from "./fence.js"

import { Context, Deferred, Effect, Layer, Option, Ref } from "effect"

export interface Interface {
  readonly retired: Deferred.Deferred<string>
  readonly retire: (reason: string) => Effect.Effect<void>
  readonly isRetired: Effect.Effect<boolean>
  // oxlint-disable-next-line ren/no-comments -- A shutdown of the space: the brain takes no new turn and no Chat API change from then, and still syncs.
  readonly close: (reason: string) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- Why the brain takes no new work: it is closed for a shutdown, or Ren retired its generation.
  readonly closed: Effect.Effect<Option.Option<string>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Fence") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const retired = yield* Deferred.make<string>()
    const closing = yield* Ref.make(Option.none<string>())
    return Service.of({
      retired,
      retire: (reason) =>
        Effect.logError("Ren retired this brain's generation; the brain fences itself").pipe(
          Effect.annotateLogs({ reason }),
          Effect.andThen(Ref.update(closing, (found) => (Option.isSome(found) ? found : Option.some(reason)))),
          Effect.andThen(Deferred.succeed(retired, reason)),
          Effect.asVoid,
        ),
      isRetired: Deferred.isDone(retired),
      close: (reason) => Ref.set(closing, Option.some(reason)),
      closed: Ref.get(closing),
    })
  }),
)
