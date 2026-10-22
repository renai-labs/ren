export * as TestHostApi from "./host-api.js"

import { RenHostApi } from "@ren/host-api/ren-host-api"
import { HttpApi } from "effect/http-api"

export const withoutTasks = HttpApi.make("host").add(
  RenHostApi.groups.models,
  RenHostApi.groups.environments,
  RenHostApi.groups.host,
  RenHostApi.groups.settings,
)
