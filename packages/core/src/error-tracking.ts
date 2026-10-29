export * as ErrorTracking from "./error-tracking.js"

import { Telemetry } from "@ren/util/telemetry"
import { Context, Effect, ErrorReporter, Layer, Logger, LogLevel, References, Tracer } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { Deployment } from "./deployment.js"
import { PostHog } from "./posthog.js"

const levels: Record<LogLevel.Severity, string> = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warning",
  Info: "error",
  Debug: "debug",
  Trace: "debug",
}

const reporter = ErrorReporter.layer([
  Effect.gen(function* () {
    const posthog = yield* PostHog.Service
    const deployment = yield* Deployment.resource
    const resource = {
      "service.name": deployment.serviceName,
      "service.version": deployment.serviceVersion,
      ...deployment.attributes,
    }
    return ErrorReporter.make((report) => {
      const annotations = report.fiber.getRef(References.CurrentLogAnnotations)
      const user = annotations["posthogDistinctId"]
      const span = Context.getOrUndefined(report.fiber.context, Tracer.ParentSpan)
      const request = Context.getOrUndefined(report.fiber.context, HttpServerRequest.HttpServerRequest)
      const route = Context.getOrUndefined(report.fiber.context, HttpRouter.RouteContext)
      posthog.captureException(
        Telemetry.withoutQueryParameters(report.error),
        typeof user === "string" ? user : "ren-server",
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
])

export const layer = Layer.mergeAll(reporter, Logger.layer([Telemetry.reportErrorLogs], { mergeWithExisting: true }))
