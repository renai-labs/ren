export * as SpaceSettings from "./space-settings.js"

import { Schema } from "effect"
import { Primitive } from "./primitive.js"
import { Settings } from "./settings.js"
import { Space } from "./space.js"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Space.ID,
  settings: Settings.Info,
  canUpdate: Schema.Boolean,
  updatedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "SpaceSettings.Info" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({ settings: Settings.Info }).annotate({
  identifier: "SpaceSettings.UpdateInput",
})

export const definition = Primitive.define({
  name: "space-settings",
  plural: "space-settings",
  id: Space.ID,
  info: Info,
  get: true,
  update: { input: UpdateInput, result: Info },
})
