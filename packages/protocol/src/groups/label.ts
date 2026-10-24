import { Label } from "@ren/schema/label"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const LabelGroup = Primitive.group(Label.definition, "sdk", [
  Primitive.list(Label.definition).annotate(Mcp.Tool, true),
  Primitive.create(Label.definition),
  Primitive.update(Label.definition),
  Primitive.archive(Label.definition),
])
