export * as EnvironmentClient from "./environment-client.js"

import { Duration, Effect, Layer, Option, Record } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { RpcClient, RpcClientError, RpcGroup, RpcMiddleware, RpcSerialization } from "effect/rpc"
import { EnvironmentApi } from "./environment-api.js"

export const path = "/v1/rpc"

export const rpcUrl = (url: URL) => `${url.href.replace(/\/$/u, "")}${path}`

export const answerWithin = Duration.seconds(30)

const answerWithinFor: Readonly<Record<string, Duration.Duration>> = {
  "executor.hello": Duration.seconds(10),
  "process.heartbeat": Duration.seconds(5),
  "process.kill": Duration.seconds(5),
  // oxlint-disable-next-line ren/no-comments -- R39: a reference archive can have 1 GiB; the executor stops a stalled download after 60 s itself.
  "files.unpack": Duration.minutes(10),
  "drives.mount": Duration.minutes(1),
} satisfies Partial<Record<RpcGroup.Rpcs<typeof EnvironmentApi.Rpcs>["_tag"], Duration.Duration>>

const isUnauthorizedResponse = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError &&
  error.reason._tag === "HttpError" &&
  error.reason.kind === "StatusCodeError" &&
  error.reason.cause instanceof HttpClientError.StatusCodeError &&
  error.reason.cause.response.status === 401

export const isNoAnswer = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError && !isUnauthorizedResponse(error)

export type Client = RpcClient.RpcClient<RpcGroup.Rpcs<typeof EnvironmentApi.Rpcs>, RpcClientError.RpcClientError>

export interface Options {
  readonly url: URL
  readonly token: Effect.Effect<string>
  readonly onNoAnswer?: Effect.Effect<void>
  readonly onRefused?: (token: string) => Effect.Effect<void>
}

const unauthorized = () => Effect.fail(new EnvironmentApi.UnauthorizedError({ message: "Authentication required" }))

const limit = (tag: string) =>
  tag === "process.output"
    ? Option.none()
    : Option.some(Record.get(answerWithinFor, tag).pipe(Option.getOrElse(() => answerWithin)))

const layer = (options: Options) =>
  Layer.mergeAll(
    RpcMiddleware.layerClient(EnvironmentApi.Authentication, (call) => {
      const answered = Option.match(limit(call.rpc._tag), {
        onNone: () => call.next,
        onSome: (duration) => (request: typeof call.request) =>
          call.next(request).pipe(
            Effect.timeoutOrElse({
              duration,
              orElse: () =>
                Effect.fail(
                  new RpcClientError.RpcClientError({
                    reason: new RpcClientError.RpcClientDefect({
                      message: `The environment did not answer ${call.rpc._tag} within ${Duration.format(duration)}`,
                      cause: undefined,
                    }),
                  }),
                ),
            }),
          ),
      })
      return answered(call.request).pipe(
        // oxlint-disable-next-line ren/no-comments -- A refused call is sent once more: the token is read again, so a caller that renews a refused token gets one retry with the new one.
        Effect.catchIf(isUnauthorizedResponse, () =>
          answered(call.request).pipe(Effect.catchIf(isUnauthorizedResponse, unauthorized)),
        ),
        Effect.tapError((error) => (isNoAnswer(error) && options.onNoAnswer) || Effect.void),
      )
    }),
    Layer.effect(
      RpcClient.Protocol,
      Effect.flatMap(HttpClient.HttpClient, (client) =>
        RpcClient.makeProtocolHttp(
          client.pipe(
            HttpClient.mapRequest(HttpClientRequest.prependUrl(rpcUrl(options.url))),
            HttpClient.mapRequestEffect((request) =>
              Effect.map(options.token, (token) => HttpClientRequest.bearerToken(request, token)),
            ),
            HttpClient.transform((response, request) =>
              Effect.tap(response, (received) =>
                received.status === 401 && options.onRefused
                  ? options.onRefused(request.headers.authorization?.replace(/^Bearer /u, "") ?? "")
                  : Effect.void,
              ),
            ),
            HttpClient.filterStatusOk,
          ),
        ),
      ),
    ),
  ).pipe(Layer.provide(RpcSerialization.layerNdjson))

export const make = (options: Options) =>
  Layer.build(layer(options)).pipe(
    Effect.flatMap((context) => RpcClient.make(EnvironmentApi.Rpcs).pipe(Effect.provide(context))),
  )
