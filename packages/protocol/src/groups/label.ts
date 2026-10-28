import { Label } from "@ren/schema/label"
import { Primitive } from "../primitive.js"

export const LabelGroup = Primitive.group(Label.definition, "sdk", [
  Primitive.list(Label.definition),
  Primitive.create(Label.definition),
  Primitive.update(Label.definition),
  Primitive.archive(Label.definition),
])
