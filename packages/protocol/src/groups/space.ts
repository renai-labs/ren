import { Space } from "@ren/schema/space"
import { Primitive } from "../primitive.js"

export const SpaceGroup = Primitive.group(Space.definition, "sdk", [
  Primitive.list(Space.definition),
  Primitive.get(Space.definition),
  Primitive.create(Space.definition),
  Primitive.update(Space.definition),
  Primitive.archive(Space.definition),
])
