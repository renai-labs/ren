import { SpaceSettings } from "@ren/schema/space-settings"
import { Primitive } from "../primitive.js"

export const SpaceSettingsGroup = Primitive.group(SpaceSettings.definition, "sdk", [
  Primitive.get(SpaceSettings.definition),
  Primitive.update(SpaceSettings.definition),
])
