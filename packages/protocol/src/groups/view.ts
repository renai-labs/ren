import { View } from "@ren/schema/view"
import { Primitive } from "../primitive.js"

export const ViewGroup = Primitive.group(View.definition, "sdk", [
  Primitive.list(View.definition),
  Primitive.create(View.definition),
  Primitive.update(View.definition),
  Primitive.archive(View.definition),
])
