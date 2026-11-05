export * as OrganizationSettings from "./organization-settings.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Primitive } from "./primitive.js"
import { Settings } from "./settings.js"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Auth.OrganizationID,
  settings: Settings.Info,
  canUpdate: Schema.Boolean,
  updatedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "OrganizationSettings.Info" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  settings: Settings.Info.mapFields((fields) => ({
    ...fields,
    timezone: Schema.optionalKey(
      Settings.TimeZone.annotate({
        description: `The IANA time zone that agents, shells and new schedules use. Without it, ${Settings.defaultTimezone}.`,
      }),
    ),
  })).annotate({ identifier: "OrganizationSettings.Settings" }),
}).annotate({
  identifier: "OrganizationSettings.UpdateInput",
})

export const definition = Primitive.define({
  name: "organization-settings",
  plural: "organization-settings",
  id: Auth.OrganizationID,
  info: Info,
  get: true,
  update: { input: UpdateInput, result: Info },
})
