#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { App } from "./app.js"
import { Runtime } from "./runtime.js"
import { Connection } from "./services/connection.js"
import { Output } from "./services/output.js"
import { Version } from "./version.js"

Runtime.run(App.command, { version: Version.value }).pipe(
  Effect.provide(Connection.layer),
  Effect.provide(Output.layer),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
