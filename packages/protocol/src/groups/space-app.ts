import { SpaceApp } from "@ren/schema/space-app"
import { Primitive } from "../primitive.js"

export const SpaceAppGroup = Primitive.group(SpaceApp.definition, "sdk", [
  Primitive.list(SpaceApp.definition),
  Primitive.get(SpaceApp.definition),
  Primitive.create(SpaceApp.definition),
  Primitive.update(SpaceApp.definition),
  Primitive.archive(SpaceApp.definition),
])
