export * as SpaceApp from "./space-app.js"

import { Option, Schema } from "effect"
import { App } from "./app.js"
import { AppRelease } from "./app-release.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("spa", "SpaceApp.ID")
export type ID = typeof ID.Type

const ownerPrefix = "spa_owner_"
export const ofOwner = (appId: App.ID) => ID.make(`${ownerPrefix}${Identifier.suffix(appId)}`)
export const ownerApp = (id: ID) =>
  id.startsWith(ownerPrefix) ? Option.some(App.ID.make(`app_${id.slice(ownerPrefix.length)}`)) : Option.none()

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  appId: App.ID,
  isOwner: Schema.Boolean,
  pinnedReleaseId: Schema.NullOr(AppRelease.ID),
  app: App.Info,
  release: AppRelease.Info,
  createdAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "SpaceApp.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({ spaceId: Space.ID, ...Pagination.fields(50) }).annotate({
  identifier: "SpaceApp.ListInput",
})

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  appId: App.ID,
  pinnedReleaseId: Schema.optional(Schema.NullOr(AppRelease.ID)),
}).annotate({ identifier: "SpaceApp.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({ pinnedReleaseId: Schema.NullOr(AppRelease.ID) }).annotate({
  identifier: "SpaceApp.UpdateInput",
})

export const definition = Primitive.define({
  name: "space-app",
  plural: "space-apps",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Pagination.Page(Info).annotate({ identifier: "SpaceApp.Page" }) },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
})
