#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { App } from "./app.js"
import { Release } from "./release.js"
import { Runtime } from "./runtime.js"
import { Connection } from "./services/connection.js"
import { Credentials } from "./services/credentials.js"
import { Output } from "./services/output.js"

Runtime.run(App.command, { version: Release.version }).pipe(
  Effect.provide(Connection.layer.pipe(Layer.provideMerge(Credentials.layer))),
  Effect.provide(Output.layer),
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
