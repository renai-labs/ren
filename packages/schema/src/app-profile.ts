export * as AppProfile from "./app-profile.js"

import { Schema } from "effect"
import { AppIdentity } from "./app/identity.js"
import { Auth } from "./auth.js"
import { Credential } from "./credential.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = AppIdentity.ProfileID
export type ID = typeof ID.Type

export const maximumSlugLength = 32

export const Slug = Primitive.Slug.check(
  Schema.isMaxLength(maximumSlugLength, { message: `Use ${maximumSlugLength} characters or fewer.` }),
).annotate({
  identifier: "AppProfile.Slug",
  description: "Fixed at create. It names the profile’s servers (`<mcp>__<slug>`) and labels (`<KEY>__<SLUG>`).",
})
export type Slug = typeof Slug.Type

export const Kind = Schema.Literals(["shared", "private"]).annotate({
  identifier: "AppProfile.Kind",
  description: "A shared profile belongs to the org; a private profile belongs to one person.",
})
export type Kind = typeof Kind.Type

export const ItemStatus = Schema.Literals(["ok", "missing", "reconnect", "unavailable"]).annotate({
  identifier: "AppProfile.ItemStatus",
})
export type ItemStatus = typeof ItemStatus.Type

export interface Item extends Schema.Schema.Type<typeof Item> {}
export const Item = Schema.Struct({
  item: Credential.Item,
  kind: Credential.RequirementKind,
  label: Credential.EnvName,
  name: Schema.String,
  status: ItemStatus,
  optional: Schema.Boolean.annotate({ description: "An optional item is never a gap." }),
  credentialId: Schema.NullOr(Credential.ID),
  holder: Schema.NullOr(Credential.Account).annotate({
    description: "Whose account a sign-in reached. A pasted value has none.",
  }),
}).annotate({ identifier: "AppProfile.Item" })

export interface Link extends Schema.Schema.Type<typeof Link> {}
export const Link = Schema.Struct({
  appId: AppIdentity.ID,
  profileId: Schema.NullOr(ID).annotate({ description: "Null while no profile of the dependency app is linked." }),
}).annotate({ identifier: "AppProfile.Link" })

export interface SpaceRef extends Schema.Schema.Type<typeof SpaceRef> {}
export const SpaceRef = Schema.Struct({ id: Space.ID, name: Schema.String }).annotate({
  identifier: "AppProfile.SpaceRef",
})

export interface OAuthAppGate extends Schema.Schema.Type<typeof OAuthAppGate> {}
export const OAuthAppGate = Schema.Struct({ name: Schema.String, isConfigured: Schema.Boolean }).annotate({
  identifier: "AppProfile.OAuthAppGate",
  description: "An org OAuth app that the app needs. One gate per app, shown on every profile.",
})

export interface Skipped extends Schema.Schema.Type<typeof Skipped> {}
export const Skipped = Schema.Struct({
  kind: Schema.Literals(["mcps", "skills", "env"]),
  slug: Schema.String,
  also: Primitive.Slug.annotate({ description: "The older app in the org that has the same name." }),
}).annotate({
  identifier: "AppProfile.Skipped",
  description: "A part of the app that Ren leaves out in this org, because an older app has the same name (P25).",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  appId: AppIdentity.ID,
  appSlug: Primitive.Slug,
  slug: Slug,
  name: Primitive.Name,
  kind: Kind,
  userId: Schema.NullOr(Auth.UserID),
  allSpaces: Schema.Boolean,
  spaces: Schema.Array(SpaceRef).annotate({ description: "The listed spaces that the caller can see." }),
  hiddenSpaces: Schema.Int.annotate({ description: "The count of listed spaces that the caller cannot see." }),
  canAccess: Schema.Boolean.annotate({
    description: "True when the caller may change the spaces that list the profile.",
  }),
  canShareEverySpace: Schema.Boolean.annotate({
    description: "True when the caller may share the profile with every space.",
  }),
  links: Schema.Array(Link),
  items: Schema.Array(Item),
  unused: Schema.Array(Schema.Struct({ credentialId: Credential.ID, label: Credential.EnvName })).annotate({
    description: "Credentials of items that the app no longer declares. The egress refuses them.",
  }),
  oauthApps: Schema.Array(OAuthAppGate),
  skipped: Schema.Array(Skipped),
  createdBy: Schema.NullOr(Auth.UserID),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "AppProfile.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  appId: Schema.optional(AppIdentity.ID),
  spaceId: Schema.optional(Space.ID.annotate({ description: "Only the profiles that this space reaches." })),
  ...Pagination.fields(50),
}).annotate({ identifier: "AppProfile.ListInput" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  appId: AppIdentity.ID,
  name: Primitive.Name,
  slug: Slug,
  kind: Kind,
  allSpaces: Schema.optional(Schema.Boolean),
  spaceIds: Schema.optional(Schema.Array(Space.ID)),
  links: Schema.optional(Schema.Array(Schema.Struct({ appId: AppIdentity.ID, profileId: ID }))),
}).annotate({ identifier: "AppProfile.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({ name: Schema.optional(Primitive.Name) }).annotate({
  identifier: "AppProfile.UpdateInput",
})

export interface AccessInput extends Schema.Schema.Type<typeof AccessInput> {}
export const AccessInput = Schema.Struct({
  add: Schema.optional(Schema.Array(Space.ID)),
  remove: Schema.optional(Schema.Array(Space.ID)),
  allSpaces: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "AppProfile.AccessInput" })

export interface LinkInput extends Schema.Schema.Type<typeof LinkInput> {}
export const LinkInput = Schema.Struct({ appId: AppIdentity.ID, profileId: Schema.NullOr(ID) }).annotate({
  identifier: "AppProfile.LinkInput",
})

export interface PromoteInput extends Schema.Schema.Type<typeof PromoteInput> {}
export const PromoteInput = Schema.Struct({}).annotate({ identifier: "AppProfile.PromoteInput" })

export interface Reach extends Schema.Schema.Type<typeof Reach> {}
export const Reach = Schema.Struct({ profiles: Schema.Array(Info) }).annotate({
  identifier: "AppProfile.Reach",
  description: "The profiles that a chat reaches, with their gaps.",
})

export const definition = Primitive.define({
  name: "app-profile",
  plural: "app-profiles",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Pagination.Page(Info).annotate({ identifier: "AppProfile.Page" }) },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  actions: {
    access: { input: AccessInput, result: Info },
    link: { input: LinkInput, result: Info },
    promote: { input: PromoteInput, result: Info },
  },
})
