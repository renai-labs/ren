import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Primitive } from "../primitive.js"

export const EnvironmentTemplateGroup = Primitive.group(EnvironmentTemplate.definition, "sdk", [
  Primitive.list(EnvironmentTemplate.definition),
  Primitive.get(EnvironmentTemplate.definition),
  Primitive.create(EnvironmentTemplate.definition),
  Primitive.update(EnvironmentTemplate.definition),
  Primitive.archive(EnvironmentTemplate.definition),
])
