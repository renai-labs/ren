import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { ExecutorApi } from "@ren/hand-api/executor-api"
import { Config, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { Sandbox } from "./sandbox.js"
import { Server } from "./server.js"

HttpRouter.serve(Server.layer).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(Sandbox.layer),
  Layer.provide(BunServices.layer),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(ExecutorApi.port)) })),
  Layer.launch,
  BunRuntime.runMain,
)
