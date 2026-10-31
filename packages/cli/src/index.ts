#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Fiber, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { App } from "./app.js"
import { Release } from "./release.js"
import { Runtime } from "./runtime.js"
import { Connection } from "./services/connection.js"
import { Credentials } from "./services/credentials.js"
import { Output } from "./services/output.js"
import { Upgrade } from "./upgrade.js"

Effect.gen(function* () {
  const output = yield* Output.Service
  const update = yield* Effect.forkChild(Upgrade.notice)
  yield* Runtime.run(App.command, { version: Release.version })
  const newer = yield* Fiber.join(update)
  if (Option.isSome(newer)) yield* output.diagnostic(`ren2 v${newer.value} is available. Run ren2 upgrade.`)
}).pipe(
  Effect.provide(Connection.layer.pipe(Layer.provideMerge(Credentials.layer))),
  Effect.provide(Output.layer),
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
