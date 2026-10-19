import { SpaceEnvironment } from "@ren/schema/space-environment"
import { Primitive } from "../primitive.js"

export const SpaceEnvironmentGroup = Primitive.group(SpaceEnvironment.definition, "sdk", [
  Primitive.list(SpaceEnvironment.definition),
  Primitive.create(SpaceEnvironment.definition),
  Primitive.archive(SpaceEnvironment.definition),
])
