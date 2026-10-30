export * as Telemetry from "./telemetry.js"

import {
  Cause,
  Config,
  Context,
  Effect,
  ErrorReporter,
  Formatter,
  Layer,
  Logger,
  LogLevel,
  Option,
  Predicate,
  Schema,
  Tracer,
} from "effect"
import { HttpClient } from "effect/http"
import { OtlpExporter, OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/observability"

export interface Target {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface Resource {
  readonly serviceName: string
  readonly serviceVersion: string
  readonly attributes: Readonly<Record<string, string>>
}

export interface Targets {
  readonly traces: Option.Option<Target>
  readonly logs: Option.Option<Target>
  readonly metrics: Option.Option<Target>
}

export class Service extends Context.Service<Service, { readonly resource: Resource }>()("@ren/telemetry/Telemetry") {}

const record = (name: string) =>
  Config.Record(Schema.StringFromUriComponent, Schema.StringFromUriComponent, name, { trim: true })

const encode = (values: Readonly<Record<string, string>>) =>
  Object.entries(values)
    .map((entry) => entry.map(encodeURIComponent).join("="))
    .join(",")

const target = (signal: "traces" | "logs" | "metrics") => {
  const name = signal.toUpperCase()
  return Config.all({
    exporter: Config.Literals(["otlp", "none"], `OTEL_${name}_EXPORTER`).pipe(Config.withDefault("otlp")),
    url: Config.option(
      Config.String(`OTEL_EXPORTER_OTLP_${name}_ENDPOINT`).pipe(
        Config.orElse(() =>
          Config.map(
            Config.String("OTEL_EXPORTER_OTLP_ENDPOINT"),
            (base) => `${base.replace(/\/$/u, "")}/v1/${signal}`,
          ),
        ),
      ),
    ),
    headers: record(`OTEL_EXPORTER_OTLP_${name}_HEADERS`).pipe(
      Config.orElse(() => record("OTEL_EXPORTER_OTLP_HEADERS")),
      Config.withDefault({}),
    ),
  }).pipe(
    Config.map((found) =>
      found.exporter === "none"
        ? Option.none<Target>()
        : Option.map(found.url, (url): Target => ({ url, headers: found.headers })),
    ),
  )
}

export const targets: Config.Config<Targets> = Config.all({
  traces: target("traces"),
  logs: target("logs"),
  metrics: target("metrics"),
})

export const attributes = record("OTEL_RESOURCE_ATTRIBUTES").pipe(Config.withDefault({}))

export const variables = (attributes: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Object.keys(attributes).length > 0 ? { OTEL_RESOURCE_ATTRIBUTES: encode(attributes) } : {}

const parameters = "\nparams: "

export const withoutQueryParameters = <A>(error: A): A | Error => {
  if (!(error instanceof Error) || !error.message.includes(parameters)) return error
  const message = error.message.slice(0, error.message.indexOf(parameters))
  return Object.assign(new Error(message, { cause: error.cause }), {
    name: error.name,
    stack: error.stack?.replace(error.message, message) ?? message,
  })
}

const errorLog = (message: string, severity: LogLevel.Severity) =>
  Object.assign(new Error(message), { name: "ErrorLog", stack: "", [ErrorReporter.severity]: severity })

const logged = new WeakSet<object>()

const failureOf = (reason: Cause.Reason<unknown>): unknown => {
  if (reason._tag === "Fail") return reason.error
  if (reason._tag === "Die") return reason.defect
  return undefined
}

const isLogged = (reason: Cause.Reason<unknown>) => {
  const failure = failureOf(reason)
  return Predicate.isObjectKeyword(failure) && logged.has(failure)
}

const writeToLogs = ErrorReporter.make((report) => {
  const date = new Date(Number(report.timestamp / 1_000_000n))
  for (const logger of report.fiber.getRef(Logger.CurrentLoggers))
    if (logger !== reportErrorLogs)
      logger.log({
        message: withoutQueryParameters(report.error).message,
        logLevel: report.severity === "Fatal" ? "Fatal" : "Error",
        cause: Cause.die(report.error),
        fiber: report.fiber,
        date,
      })
})

const reportsToLogs: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: (options) =>
    writeToLogs.report({
      ...options,
      cause: Cause.fromReasons(options.cause.reasons.filter((reason) => !isLogged(reason))),
    }),
}

const reportErrorLogs = Logger.make((log) => {
  if (!LogLevel.isGreaterThanOrEqualTo(log.logLevel, "Error")) return
  for (const reason of log.cause.reasons) {
    const failure = failureOf(reason)
    if (Predicate.isObjectKeyword(failure)) logged.add(failure)
  }
  const timestamp = BigInt(log.date.getTime()) * 1_000_000n
  const cause = log.cause.reasons.some((reason) => reason._tag !== "Interrupt")
    ? log.cause
    : Cause.die(
        errorLog(
          (Array.isArray(log.message) ? log.message : [log.message])
            .map((part) => (typeof part === "string" ? part : Formatter.format(part)))
            .join(" "),
          log.logLevel === "Fatal" ? "Fatal" : "Error",
        ),
      )
  for (const reporter of log.fiber.getRef(ErrorReporter.CurrentErrorReporters))
    if (reporter !== reportsToLogs) reporter.report({ cause, fiber: log.fiber, timestamp })
})

const warnOnFailure = Layer.effect(
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

export const layer = (
  options: Targets & {
    readonly resource: Resource
    readonly metricsResource?: Resource
    readonly continueTraces?: boolean
  },
) =>
  Layer.mergeAll(
    Layer.succeed(Service, Service.of({ resource: options.resource })),
    Option.match(options.traces, {
      onNone: () => Layer.empty,
      onSome: (found) =>
        Layer.effect(
          Tracer.Tracer,
          Effect.map(OtlpTracer.make({ ...found, resource: options.resource }), (tracer) =>
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
    Logger.layer(
      [
        reportErrorLogs,
        ...Option.match(options.logs, {
          onNone: () => [],
          onSome: (found) => [
            Effect.map(OtlpLogger.make({ ...found, resource: options.resource }), (otlp) =>
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
        }),
      ],
      { mergeWithExisting: true },
    ),
    Option.match(options.metrics, {
      onNone: () => Layer.empty,
      onSome: (found) =>
        Layer.effectDiscard(
          OtlpMetrics.make({
            ...found,
            resource: options.metricsResource ?? options.resource,
            temporality: "delta",
            exportInterval: "1 minute",
          }),
        ),
    }),
    ErrorReporter.layer([reportsToLogs], { mergeWithExisting: true }),
  ).pipe(
    Layer.provideMerge(OtlpExporter.layerFlusher),
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(warnOnFailure),
  )
