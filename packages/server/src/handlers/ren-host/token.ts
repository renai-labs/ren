import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { Brains } from "@ren/core/brains"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostTokenHandler = HttpApiBuilder.group(RenHostApi, "host", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* Brains.Service
    return handlers.handle("host.refresh", () =>
      Effect.gen(function* () {
        const host = yield* CurrentHost
        return yield* brain.refreshHostToken(host)
      }),
    )
  }),
)
