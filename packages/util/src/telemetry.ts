export * as Telemetry from "./telemetry.js"

import { Cause, Effect, ErrorReporter, Layer, Logger, LogLevel, Option, Schema, Tracer } from "effect"
import { HttpClient } from "effect/http"
import { OtlpExporter, OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/observability"

export interface Target {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface Resource {
  readonly serviceName: string
  readonly serviceVersion: string
  readonly attributes: Readonly<Record<string, string>>
}

const open = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)])

export const KeyValue = Schema.Struct({
  key: Schema.String,
  value: open({
    stringValue: Schema.optionalKey(Schema.NullOr(Schema.String)),
    boolValue: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    intValue: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
    doubleValue: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  }),
})
export type KeyValue = typeof KeyValue.Type

const OtlpResourceSchema = open({ attributes: Schema.Array(KeyValue) })

export const Traces = open({ resourceSpans: Schema.Array(open({ resource: OtlpResourceSchema })) })
export type Traces = typeof Traces.Type

export const Logs = open({
  resourceLogs: Schema.Array(
    open({
      resource: OtlpResourceSchema,
      scopeLogs: Schema.Array(
        open({
          logRecords: Schema.Array(
            open({
              attributes: Schema.Array(KeyValue),
              severityText: Schema.optionalKey(Schema.String),
              traceId: Schema.optionalKey(Schema.String),
              spanId: Schema.optionalKey(Schema.String),
            }),
          ),
        }),
      ),
    }),
  ),
})
export type Logs = typeof Logs.Type

const parameters = "\nparams: "

export const withoutQueryParameters = <A>(error: A): A | Error => {
  if (!(error instanceof Error) || !error.message.includes(parameters)) return error
  const message = error.message.slice(0, error.message.indexOf(parameters))
  return Object.assign(new Error(message, { cause: error.cause }), {
    name: error.name,
    stack: error.stack?.replace(error.message, message) ?? message,
  })
}

export const reportErrorLogs = Logger.make((log) => {
  if (!LogLevel.isGreaterThanOrEqualTo(log.logLevel, "Error")) return
  const timestamp = BigInt(log.date.getTime()) * 1_000_000n
  for (const reporter of log.fiber.getRef(ErrorReporter.CurrentErrorReporters))
    reporter.report({ cause: log.cause, fiber: log.fiber, timestamp })
})

const reportToLogs = ErrorReporter.layer(
  [
    ErrorReporter.make((report) => {
      const date = new Date(Number(report.timestamp / 1_000_000n))
      for (const logger of report.fiber.getRef(Logger.CurrentLoggers))
        logger.log({
          message: withoutQueryParameters(report.error).message,
          logLevel: report.severity === "Fatal" ? "Fatal" : "Error",
          cause: Cause.die(report.error),
          fiber: report.fiber,
          date,
        })
    }),
  ],
  { mergeWithExisting: true },
)

export const warnOnFailure = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, (client) =>
    client.pipe(
      HttpClient.tap((response) =>
        response.status < 300
          ? Effect.void
          : Effect.logWarning(`A telemetry export to ${response.request.url} answered ${response.status}`),
      ),
      HttpClient.tapError((error) => Effect.logWarning(`A telemetry export failed: ${error.message}`)),
    ),
  ),
)

export const layer = (options: {
  readonly resource: Resource
  readonly traces: Option.Option<Target>
  readonly logs: Option.Option<Target>
  readonly reportErrors?: boolean
  readonly continueTraces?: boolean
}) =>
  Layer.mergeAll(
    Option.match(options.traces, {
      onNone: () => Layer.empty,
      onSome: (target) =>
        Layer.effect(
          Tracer.Tracer,
          Effect.map(OtlpTracer.make({ ...target, resource: options.resource }), (tracer) =>
            Tracer.make({
              span(spanOptions) {
                const span = tracer.span({
                  ...spanOptions,
                  sampled:
                    spanOptions.sampled ||
                    Option.exists(
                      spanOptions.parent,
                      (parent) => parent.sampled && (parent._tag === "Span" || options.continueTraces === true),
                    ),
                })
                const attribute = span.attribute.bind(span)
                return Object.assign(span, {
                  attribute: (key: string, value: unknown) => {
                    if (key === "url.query") return
                    attribute(key, key === "url.full" && typeof value === "string" ? value.split("?", 1).at(0) : value)
                  },
                })
              },
              context: tracer.context,
            }),
          ),
        ),
    }),
    Option.match(options.logs, {
      onNone: () => Layer.empty,
      onSome: (target) =>
        Logger.layer(
          [
            Effect.map(OtlpLogger.make({ ...target, resource: options.resource }), (otlp) =>
              Logger.make((log) => {
                if (!LogLevel.isGreaterThanOrEqualTo(log.logLevel, "Error")) return
                otlp.log({
                  ...log,
                  message: Array.isArray(log.message) ? log.message.map(withoutQueryParameters) : log.message,
                  cause: Cause.fromReasons(
                    log.cause.reasons.map((reason) => {
                      if (reason._tag === "Fail") return Cause.makeFailReason(withoutQueryParameters(reason.error))
                      if (reason._tag === "Die") return Cause.makeDieReason(withoutQueryParameters(reason.defect))
                      return reason
                    }),
                  ),
                })
              }),
            ),
          ],
          { mergeWithExisting: true },
        ),
    }),
    options.reportErrors ? reportToLogs : Layer.empty,
  ).pipe(
    Layer.provideMerge(OtlpExporter.layerFlusher),
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(warnOnFailure),
  )
