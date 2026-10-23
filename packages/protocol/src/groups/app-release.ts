import { AppRelease } from "@ren/schema/app-release"
import { Primitive } from "../primitive.js"

export const AppReleaseGroup = Primitive.group(AppRelease.definition, "sdk", [
  Primitive.list(AppRelease.definition),
  Primitive.get(AppRelease.definition),
  Primitive.create(AppRelease.definition),
])
