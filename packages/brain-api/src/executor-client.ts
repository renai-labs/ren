export * as ExecutorClient from "./executor-client.js"

import { Effect, Layer } from "effect"
import { Headers, HttpClient, HttpClientError, HttpClientRequest } from "effect/http"
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

const layer = (options: { readonly url: string; readonly token: string }) =>
  Layer.mergeAll(
    RpcMiddleware.layerClient(Authentication, (call) =>
      call
        .next({
          ...call.request,
          headers: Headers.set(call.request.headers, "authorization", `Bearer ${options.token}`),
        })
        .pipe(
          Effect.catchIf(isUnauthorizedResponse, () =>
            Effect.fail(new UnauthorizedError({ message: "Authentication required" })),
          ),
        ),
    ),
    Layer.effect(
      RpcClient.Protocol,
      Effect.flatMap(HttpClient.HttpClient, (client) =>
        RpcClient.makeProtocolHttp(
          client.pipe(
            HttpClient.mapRequest(HttpClientRequest.prependUrl(options.url + path)),
            HttpClient.mapRequest(HttpClientRequest.bearerToken(options.token)),
            HttpClient.filterStatusOk,
          ),
        ),
      ),
    ),
  ).pipe(Layer.provide(RpcSerialization.layerNdjson))

export const make = (options: { readonly url: string; readonly token: string }) =>
  Layer.build(layer(options)).pipe(
    Effect.flatMap((context) => RpcClient.make(ExecutorApi).pipe(Effect.provide(context))),
  )
