export * as Server from "./server.js"

import { HandToken } from "@ren/hand-api/hand-token"
import { Authentication, Caller, ExecutorApi, UnauthorizedError } from "@ren/hand-api/executor-api"
import { ExecutorClient } from "@ren/hand-api/executor-client"
import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { Signature } from "@ren/hand-api/signature"
import { Config, Effect, Layer, Option, Schema, Stream } from "effect"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { Executor } from "./executor.js"

const unauthorized = new UnauthorizedError({ message: "Authentication required" })

const authenticationCheck = Effect.gen(function* () {
  const publicKeys = yield* Config.schema(Signature.PublicKeys, ExecutorVariables.publicKeys)
  const executor = yield* Executor.Service
  return (authorizationHeader: string | undefined) => {
    const token = authorizationHeader?.toLowerCase().startsWith("bearer ") ? authorizationHeader.slice(7).trim() : ""
    return (!token ? Effect.succeedNone : HandToken.verify(publicKeys, token)).pipe(
      Effect.map((verifiedClaims) =>
        verifiedClaims.pipe(
          Option.filter((claims) => claims.hand === executor.hello.handId),
          Option.map((claims) => ({ brain: claims.brain })),
        ),
      ),
    )
  }
})

const httpAuthentication = HttpRouter.middleware()(
  Effect.gen(function* () {
    const authenticate = yield* authenticationCheck
    return (next) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (Option.isNone(yield* authenticate(request.headers.authorization)))
          return HttpServerResponse.jsonUnsafe(Schema.encodeSync(UnauthorizedError)(unauthorized), { status: 401 })
        return yield* next
      })
  }),
).layer

const rpcAuthentication = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const authenticate = yield* authenticationCheck
    return (next, request) =>
      authenticate(Option.getOrUndefined(Headers.get(request.headers, "authorization"))).pipe(
        Effect.flatMap((caller) =>
          Option.isNone(caller) ? Effect.fail(unauthorized) : Effect.provideService(next, Caller, caller.value),
        ),
      )
  }),
)

const operations = ExecutorApi.toLayer(
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    return ExecutorApi.of({
      "executor.hello": () => Effect.succeed(executor.hello),
      "process.spawn": (input) => Effect.flatMap(Caller, (caller) => executor.spawn(caller.brain, input)),
      "process.output": (input) =>
        Stream.unwrap(
          Effect.flatMap(Caller, (caller) => executor.output(caller.brain, input.id, input.cursor, input.window)),
        ),
      "process.write": (input) =>
        Effect.flatMap(Caller, (caller) => executor.writeStdin(caller.brain, input.id, input.data, input.end ?? false)),
      "process.heartbeat": (input) => Effect.flatMap(Caller, (caller) => executor.heartbeat(caller.brain, input.id)),
      "process.kill": (input) =>
        Effect.flatMap(Caller, (caller) =>
          executor.kill(caller.brain, input.id, input.signal ?? "SIGTERM", input.forceKillAfterMs),
        ),
      "files.read": (input) => executor.read(input.path, input.range),
      "files.write": (input) => executor.write(input.path, input.bytes),
      "files.stat": (input) => executor.stat(input.path),
      "files.list": (input) => executor.list(input.path),
      "files.remove": (input) => executor.remove(input.path),
      "files.move": (input) => executor.move(input.from, input.to),
      "files.mkdir": (input) => executor.mkdir(input.path),
    })
  }),
)

export const layer = RpcServer.layerHttp({ group: ExecutorApi, path: ExecutorClient.path, protocol: "http" }).pipe(
  Layer.provide(operations),
  Layer.provide(rpcAuthentication),
  Layer.provide(httpAuthentication),
  Layer.provide(RpcSerialization.layerNdjson),
)
