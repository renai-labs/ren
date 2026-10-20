import { OrganizationSettings } from "@ren/schema/organization-settings"
import { Primitive } from "../primitive.js"

export const OrganizationSettingsGroup = Primitive.group(OrganizationSettings.definition, "sdk", [
  Primitive.get(OrganizationSettings.definition),
  Primitive.update(OrganizationSettings.definition),
])
