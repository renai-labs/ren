export * as ErrorTracking from "./error-tracking.js"

import { Config, Context, Effect, ErrorReporter, Layer, Logger, LogLevel, References, Tracer } from "effect"
import { PostHog } from "./posthog.js"

const levels: Record<LogLevel.Severity, string> = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warning",
  Info: "error",
  Debug: "debug",
  Trace: "debug",
}

const reportErrorLogs = Logger.make((log) => {
  if (!LogLevel.isGreaterThanOrEqualTo(log.logLevel, "Error")) return
  const timestamp = BigInt(log.date.getTime()) * 1_000_000n
  for (const reporter of log.fiber.getRef(ErrorReporter.CurrentErrorReporters))
    reporter.report({ cause: log.cause, fiber: log.fiber, timestamp })
})

const reporter = ErrorReporter.layer([
  Effect.gen(function* () {
    const posthog = yield* PostHog.Service
    const resource = {
      "service.name": "ren-server",
      "service.version": yield* Config.String("REN_VERSION").pipe(Config.withDefault("development")),
      "deployment.environment.name": yield* Config.String("REN_DEPLOYMENT").pipe(Config.withDefault("development")),
    }
    return ErrorReporter.make((report) => {
      const annotations = report.fiber.getRef(References.CurrentLogAnnotations)
      const user = annotations["posthogDistinctId"]
      const span = Context.getOrUndefined(report.fiber.context, Tracer.ParentSpan)
      posthog.captureException(report.error, typeof user === "string" ? user : "ren-server", {
        ...annotations,
        ...report.attributes,
        ...resource,
        $exception_level: levels[report.severity],
        ...(span && { $trace_id: span.traceId, $span_id: span.spanId }),
        ...(typeof user !== "string" && { $process_person_profile: false }),
      })
    })
  }),
])

export const layer = Layer.mergeAll(reporter, Logger.layer([reportErrorLogs], { mergeWithExisting: true }))
