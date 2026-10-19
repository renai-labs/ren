import { Environment } from "@ren/schema/environment"
import { Primitive } from "../primitive.js"

export const EnvironmentGroup = Primitive.group(Environment.definition, "sdk", [
  Primitive.list(Environment.definition),
  Primitive.get(Environment.definition),
  Primitive.create(Environment.definition),
  Primitive.update(Environment.definition),
  Primitive.archive(Environment.definition),
])
