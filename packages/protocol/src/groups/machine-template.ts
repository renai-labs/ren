import { MachineTemplate } from "@ren/schema/machine-template"
import { Primitive } from "../primitive.js"

export const MachineTemplateGroup = Primitive.group(MachineTemplate.definition, "sdk", [
  Primitive.list(MachineTemplate.definition),
  Primitive.get(MachineTemplate.definition),
  Primitive.create(MachineTemplate.definition),
  Primitive.update(MachineTemplate.definition),
  Primitive.archive(MachineTemplate.definition),
  Primitive.action(MachineTemplate.definition, "retryBuild"),
  Primitive.action(MachineTemplate.definition, "affectedSpaces"),
])
