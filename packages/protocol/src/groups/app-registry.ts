import { AppRegistry } from "@ren/schema/app-registry"
import { Primitive } from "../primitive.js"

export const AppRegistryGroup = Primitive.group(AppRegistry.definition, "sdk", [
  Primitive.list(AppRegistry.definition),
  Primitive.get(AppRegistry.definition),
])
