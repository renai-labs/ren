import { CurrentHost, HostApi } from "@ren/brain-api/host-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostHandsHandler = HttpApiBuilder.group(HostApi, "hands", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers
      .handle("hands.access", () =>
        Effect.gen(function* () {
          const host = yield* CurrentHost
          return yield* brain.accessHand(host)
        }),
      )
      .handle("hands.release", () =>
        Effect.gen(function* () {
          const host = yield* CurrentHost
          yield* brain.releaseHand(host)
        }),
      )
  }),
)
