import { SpaceEnvironmentTemplate } from "@ren/schema/space-environment-template"
import { Primitive } from "../primitive.js"

export const SpaceEnvironmentTemplateGroup = Primitive.group(SpaceEnvironmentTemplate.definition, "sdk", [
  Primitive.list(SpaceEnvironmentTemplate.definition),
  Primitive.create(SpaceEnvironmentTemplate.definition),
  Primitive.archive(SpaceEnvironmentTemplate.definition),
])
