export * as ExecutorClient from "./executor-client.js"

import { Effect, Layer } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
import { RpcClient, RpcClientError, RpcGroup, RpcMiddleware, RpcSerialization } from "effect/rpc"
import { Authentication, ExecutorApi, UnauthorizedError } from "./executor-api.js"

export const path = "/v1/rpc"

const isUnauthorizedResponse = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError &&
  error.reason._tag === "HttpError" &&
  error.reason.kind === "StatusCodeError" &&
  error.reason.cause instanceof HttpClientError.StatusCodeError &&
  error.reason.cause.response.status === 401

export type Client = RpcClient.RpcClient<RpcGroup.Rpcs<typeof ExecutorApi>, RpcClientError.RpcClientError>

export interface Options {
  readonly url: string
  readonly token: Effect.Effect<string>
  readonly renew?: Effect.Effect<void>
}

const unauthorized = () => Effect.fail(new UnauthorizedError({ message: "Authentication required" }))

const layer = (options: Options) =>
  Layer.mergeAll(
    RpcMiddleware.layerClient(Authentication, (call) =>
      call.next(call.request).pipe(
        Effect.catchIf(isUnauthorizedResponse, () => {
          if (!options.renew) return unauthorized()
          return options.renew.pipe(
            Effect.andThen(call.next(call.request)),
            Effect.catchIf(isUnauthorizedResponse, unauthorized),
          )
        }),
      ),
    ),
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
