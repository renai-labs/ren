export * as Environment from "./environment.js"

import { Config } from "effect"

export const local = Config.String("NODE_ENV").pipe(
  Config.withDefault(""),
  Config.map((value) => value === "development" || value === "test"),
)
