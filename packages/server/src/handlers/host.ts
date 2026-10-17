import { CurrentHost, HostApi } from "@ren/brain-api/host-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostHandler = HttpApiBuilder.group(HostApi, "host", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers.handle("host.refresh", () =>
      Effect.gen(function* () {
        const host = yield* CurrentHost
        return yield* brain.refreshHostToken(host)
      }),
    )
  }),
)
