export * as PostHog from "./posthog.js"

import {
  Config,
  Context,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  type LogLevel,
  Option,
  References,
  Tracer,
} from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { PostHog } from "posthog-node"
import { Telemetry } from "./telemetry.js"

const shutdownTimeout = Duration.seconds(5)

const project = Config.all({
  key: Config.String("POSTHOG_PROJECT_KEY"),
  host: Config.String("POSTHOG_HOST").pipe(Config.withDefault("https://us.i.posthog.com")),
})

const levels: Record<LogLevel.Severity, string> = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warning",
  Info: "error",
  Debug: "debug",
  Trace: "debug",
}

export const variables = Effect.map(
  Config.option(project),
  Option.match({
    onNone: (): Readonly<Record<string, string>> => ({}),
    onSome: (found) => ({ POSTHOG_PROJECT_KEY: found.key, POSTHOG_HOST: found.host }),
  }),
)

export const layer = Layer.unwrap(
  Effect.map(
    Config.option(project),
    Option.match({
      onNone: () => Layer.empty,
      onSome: (found) =>
        ErrorReporter.layer(
          [
            Effect.gen(function* () {
              const telemetry = yield* Telemetry.Service
              const resource = {
                "service.name": telemetry.resource.serviceName,
                "service.version": telemetry.resource.serviceVersion,
                ...telemetry.resource.attributes,
              }
              const client = yield* Effect.acquireRelease(
                Effect.sync(() => new PostHog(found.key, { host: found.host, flushAt: 1, flushInterval: 0 })),
                (opened) => Effect.promise(() => opened.shutdown(Duration.toMillis(shutdownTimeout))),
              )
              return ErrorReporter.make((report) => {
                const annotations = report.fiber.getRef(References.CurrentLogAnnotations)
                const user = annotations["user.id"]
                const span = Context.getOrUndefined(report.fiber.context, Tracer.ParentSpan)
                const request = Context.getOrUndefined(report.fiber.context, HttpServerRequest.HttpServerRequest)
                const route = Context.getOrUndefined(report.fiber.context, HttpRouter.RouteContext)
                client.captureException(
                  Telemetry.withoutQueryParameters(report.error),
                  typeof user === "string" ? user : telemetry.resource.serviceName,
                  {
                    ...annotations,
                    ...report.attributes,
                    ...(route && { "http.route": route.route.path }),
                    ...(request && { "url.path": new URL(request.originalUrl, "http://localhost").pathname }),
                    ...resource,
                    $exception_level: levels[report.severity],
                    ...(span?.sampled && { $trace_id: span.traceId, $span_id: span.spanId }),
                    ...(typeof user !== "string" && { $process_person_profile: false }),
                  },
                )
              })
            }),
          ],
          { mergeWithExisting: true },
        ),
    }),
  ),
)
