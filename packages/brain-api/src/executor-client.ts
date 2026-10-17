export * as ExecutorClient from "./executor-client.js"

import { Duration, Effect, Layer, Option, Record } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { RpcClient, RpcClientError, RpcGroup, RpcMiddleware, RpcSerialization } from "effect/rpc"
import { Authentication, ExecutorApi, UnauthorizedError } from "./executor-api.js"

export const path = "/v1/rpc"

export const answerWithin: Readonly<Record<Exclude<RpcGroup.Rpcs<typeof ExecutorApi>["_tag"], "process.output">, Duration.Duration>> = {
  "executor.hello": Duration.seconds(10),
  "process.spawn": Duration.seconds(30),
  "process.write": Duration.seconds(30),
  "process.heartbeat": Duration.seconds(5),
  "process.kill": Duration.seconds(5),
  "files.read": Duration.seconds(30),
  "files.write": Duration.seconds(30),
  "files.stat": Duration.seconds(30),
  "files.list": Duration.seconds(30),
  "files.remove": Duration.seconds(30),
  "files.move": Duration.seconds(30),
  "files.mkdir": Duration.seconds(30),
}

const isUnauthorizedResponse = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError &&
  error.reason._tag === "HttpError" &&
  error.reason.kind === "StatusCodeError" &&
  error.reason.cause instanceof HttpClientError.StatusCodeError &&
  error.reason.cause.response.status === 401

export const isNoAnswer = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError && !isUnauthorizedResponse(error)

export type Client = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ExecutorApi>, RpcClientError.RpcClientError>

export interface Options {
  readonly url: string
  readonly token: Effect.Effect<string>
  readonly renew?: Effect.Effect<void>
  readonly onNoAnswer?: Effect.Effect<void>
}

const unauthorized = () => Effect.fail(new UnauthorizedError({ message: "Authentication required" }))

const limits: Readonly<Record<string, Duration.Duration>> = answerWithin

const limit = (tag: string) => Record.get(limits, tag)

const layer = (options: Options) =>
  Layer.mergeAll(
    RpcMiddleware.layerClient(Authentication, (call) => {
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
                      message: `The sandbox did not answer ${call.rpc._tag} within ${Duration.format(duration)}`,
                      cause: undefined,
                    }),
                  }),
                ),
            }),
          ),
      })
      return answered(call.request).pipe(
        Effect.catchIf(isUnauthorizedResponse, () => {
          if (!options.renew) return unauthorized()
          return options.renew.pipe(
            Effect.andThen(answered(call.request)),
            Effect.catchIf(isUnauthorizedResponse, unauthorized),
          )
        }),
        Effect.tapError((error) => (isNoAnswer(error) && options.onNoAnswer) || Effect.void),
      )
    }),
    Layer.effect(
      RpcClient.Protocol,
      Effect.flatMap(HttpClient.HttpClient, (client) =>
        RpcClient.makeProtocolHttp(
          client.pipe(
            HttpClient.mapRequest(HttpClientRequest.prependUrl(options.url + path)),
            HttpClient.mapRequestEffect((request) =>
              Effect.map(options.token, (token) => HttpClientRequest.bearerToken(request, token)),
            ),
            HttpClient.filterStatusOk,
          ),
        ),
      ),
    ),
  ).pipe(Layer.provide(RpcSerialization.layerNdjson))

export const make = (options: Options) =>
  Layer.build(layer(options)).pipe(
    Effect.flatMap((context) => RpcClient.make(ExecutorApi).pipe(Effect.provide(context))),
  )
