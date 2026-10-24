import { Space } from "@ren/schema/space"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const SpaceGroup = Primitive.group(Space.definition, "sdk", [
  Primitive.list(Space.definition).annotate(Mcp.Tool, true),
  Primitive.get(Space.definition).annotate(Mcp.Tool, true),
  Primitive.create(Space.definition),
  Primitive.update(Space.definition),
  Primitive.archive(Space.definition),
])
