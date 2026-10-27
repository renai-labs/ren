#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import pkg from "../package.json"
import { App } from "./app.js"
import { Runtime } from "./runtime.js"
import { Connection } from "./services/connection.js"
import { Output } from "./services/output.js"

Runtime.run(App.command, { version: pkg.version }).pipe(
  Effect.provide(Connection.layer),
  Effect.provide(Output.layer),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
)
