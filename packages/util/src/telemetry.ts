export * as Telemetry from "./telemetry.js"

import { Cause, Effect, Layer, Logger, LogLevel, Option, Tracer } from "effect"
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

const parameters = "\nparams: "

export const withoutQueryParameters = <A>(error: A): A | Error => {
  if (!(error instanceof Error) || !error.message.includes(parameters)) return error
  const message = error.message.slice(0, error.message.indexOf(parameters))
  return Object.assign(new Error(message, { cause: error.cause }), {
    name: error.name,
    stack: error.stack?.replace(error.message, message) ?? message,
  })
}

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

export const layer = (options: {
  readonly resource: Resource
  readonly traces: Option.Option<Target>
  readonly logs: Option.Option<Target>
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
                const span = tracer.span(spanOptions)
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
  ).pipe(
    Layer.provideMerge(OtlpExporter.layerFlusher),
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(warnOnFailure),
  )
