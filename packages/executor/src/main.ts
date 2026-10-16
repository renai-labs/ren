import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Config, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { NodeCompatible } from "./node-compatible.js"
import { Server } from "./server.js"

HttpRouter.serve(Server.layer).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(NodeCompatible.layer),
  Layer.provide(BunServices.layer),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4100)) })),
  Layer.launch,
  BunRuntime.runMain,
)
