import { App } from "@ren/schema/app"
import { Primitive } from "../primitive.js"

export const AppGroup = Primitive.group(App.definition, "sdk", [
  Primitive.list(App.definition),
  Primitive.get(App.definition),
  Primitive.create(App.definition),
  Primitive.update(App.definition),
  Primitive.archive(App.definition),
  Primitive.action(App.definition, "transferOwnership"),
])
