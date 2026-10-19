export * as HostApiTest from "./host-api.js"

import { CurrentHost, HostApi } from "@ren/brain-api/host-api"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { BrainHost } from "../../src/brain-host.js"

export type Around = <A, E, R>(endpoint: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

const handlers = (around: Around) =>
  Layer.mergeAll(
    HttpApiBuilder.group(HostApi, "models", (group) =>
      Effect.map(BrainHost.Service, (brain) =>
        group.handle("models.refresh", () =>
          around("models.refresh", Effect.flatMap(CurrentHost, brain.refreshModels)),
        ),
      ),
    ),
    HttpApiBuilder.group(HostApi, "environments", (group) =>
      Effect.map(BrainHost.Service, (brain) =>
        group
          .handle("environments.access", () =>
            around("environments.access", Effect.flatMap(CurrentHost, brain.accessEnvironment)),
          )
          .handle("environments.release", () =>
            around("environments.release", Effect.flatMap(CurrentHost, brain.releaseEnvironment)),
          ),
      ),
    ),
    HttpApiBuilder.group(HostApi, "host", (group) =>
      Effect.map(BrainHost.Service, (brain) =>
        group.handle("host.refresh", () => around("host.refresh", Effect.flatMap(CurrentHost, brain.refreshHostToken))),
      ),
    ),
  )

export const layer = (around: Around = (_endpoint, effect) => effect) =>
  HttpApiBuilder.layer(HostApi).pipe(Layer.provide(handlers(around)), Layer.provide(BrainHost.hostAuthentication))
