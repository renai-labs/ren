export * as PostHog from "./posthog.js"

import { Config, Context, Duration, Effect, Layer, Option } from "effect"
import { PostHog } from "posthog-node"

const shutdownTimeout = Duration.seconds(5)

export const project = Config.all({
  key: Config.String("POSTHOG_PROJECT_KEY"),
  host: Config.String("POSTHOG_HOST").pipe(Config.withDefault("https://us.i.posthog.com")),
})

export interface Interface {
  readonly captureException: (error: Error, distinctId: string, properties: Readonly<Record<string, unknown>>) => void
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/PostHog") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* project
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new PostHog(config.key, { host: config.host })),
      (client) => Effect.promise(() => client.shutdown(Duration.toMillis(shutdownTimeout))),
    )
    return Service.of({
      captureException: (error, distinctId, properties) => client.captureException(error, distinctId, properties),
    })
  }),
)

export const layerNone = Layer.succeed(Service, Service.of({ captureException: () => {} }))

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(project), (configured) => (Option.isSome(configured) ? layer : layerNone)),
)
