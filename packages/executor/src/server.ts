export * as Server from "./server.js"

import { HandToken } from "@ren/hand-api/hand-token"
import { HandApi } from "@ren/hand-api/hand-api"
import { HandClient } from "@ren/hand-api/hand-client"
import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { Signature } from "@ren/schema/signature"
import { Config, Effect, Layer, Option, Schema, Stream } from "effect"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { Executor } from "./executor.js"

export const idleTimeoutSeconds = 10

const bearerPrefix = "bearer "

const unauthorized = new HandApi.UnauthorizedError({ message: "Authentication required" })

const authenticationCheck = Effect.gen(function* () {
  const publicKeys = yield* Config.schema(Signature.PublicKeys, ExecutorVariables.publicKeys)
  // oxlint-disable-next-line ren/no-comments -- A machine that Ren started with its generation takes only tokens for that generation.
  const generation = yield* Config.option(Config.Int(ExecutorVariables.generation))
  const executor = yield* Executor.Service
  return (authorizationHeader: string | undefined) => {
    const token = authorizationHeader?.toLowerCase().startsWith(bearerPrefix)
      ? authorizationHeader.slice(bearerPrefix.length).trim()
      : ""
    return (!token ? Effect.succeedNone : HandToken.verify(publicKeys, token)).pipe(
      Effect.map((verifiedClaims) =>
        verifiedClaims.pipe(
          Option.filter((claims) => claims.environment === executor.hello.environmentId),
          Option.filter((claims) => Option.isNone(generation) || claims.generation === generation.value),
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
          return HttpServerResponse.jsonUnsafe(Schema.encodeSync(HandApi.UnauthorizedError)(unauthorized), {
            status: 401,
          })
        return yield* next
      })
  }),
).layer

const rpcAuthentication = Layer.effect(
  HandApi.Authentication,
  Effect.gen(function* () {
    const authenticate = yield* authenticationCheck
    return (next, request) =>
      authenticate(Option.getOrUndefined(Headers.get(request.headers, "authorization"))).pipe(
        Effect.flatMap((caller) =>
          Option.isNone(caller) ? Effect.fail(unauthorized) : Effect.provideService(next, HandApi.Caller, caller.value),
        ),
      )
  }),
)

const operations = HandApi.Rpcs.toLayer(
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    return HandApi.Rpcs.of({
      "executor.hello": () => Effect.succeed(executor.hello),
      "process.spawn": (input) => Effect.flatMap(HandApi.Caller, (caller) => executor.spawn(caller.brain, input)),
      "process.output": (input) =>
        Stream.unwrap(
          Effect.flatMap(HandApi.Caller, (caller) =>
            executor.output(caller.brain, input.id, input.cursor, input.window),
          ),
        ),
      "process.write": (input) =>
        Effect.flatMap(HandApi.Caller, (caller) =>
          executor.writeStdin(caller.brain, input.id, { data: input.data, end: input.end }),
        ),
      "process.heartbeat": (input) =>
        Effect.flatMap(HandApi.Caller, (caller) => executor.heartbeat(caller.brain, input.id)),
      "process.kill": (input) =>
        Effect.flatMap(HandApi.Caller, (caller) =>
          executor.kill(caller.brain, input.id, input.signal, input.forceKillAfterMs),
        ),
      "files.read": (input) => executor.read(input.path, input.range),
      "files.write": (input) => executor.write(input.path, input.bytes),
      "files.stat": (input) => executor.stat(input.path),
      "files.list": (input) => executor.list(input.path),
      "files.remove": (input) => executor.remove(input.path),
      "files.move": (input) => executor.move(input.from, input.to),
      "files.copy": (input) => executor.copy(input.from, input.to),
      "files.mkdir": (input) => executor.mkdir(input.path),
      "files.unpack": (input) => executor.unpack(input),
      "drives.mount": (input) => executor.mount(input),
      "drives.refresh": (input) => executor.refresh(input),
      "drives.uploaded": (input) => executor.uploaded(input),
    })
  }),
)

export const layer = RpcServer.layerHttp({
  group: HandApi.Rpcs,
  path: HandClient.path,
  protocol: "http",
}).pipe(
  Layer.provide(operations),
  Layer.provide(rpcAuthentication),
  Layer.provide(httpAuthentication),
  Layer.provide(RpcSerialization.layerNdjson),
)
