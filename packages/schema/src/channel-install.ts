export * as ChannelInstall from "./channel-install.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Channel } from "./channel.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"

export const ID = Identifier.make("chi", "ChannelInstall.ID")
export type ID = typeof ID.Type

export const stateLifetimeMinutes = 30

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  provider: Channel.Provider,
  workspace: Schema.String.annotate({
    description: "The provider’s workspace id: Slack team, Linear organization, GitHub installation.",
  }),
  name: Schema.String.annotate({ description: "The workspace name, or the GitHub account login." }),
  installedBy: Schema.NullOr(Schema.Struct({ id: Auth.UserID, name: Schema.String })),
  createdAt: Schema.DateTimeUtc,
}).annotate({
  identifier: "ChannelInstall.Info",
  description: "The link between the organization and one provider workspace. Ren never returns its secret.",
})

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({ ...Pagination.fields(50) }).annotate({
  identifier: "ChannelInstall.ListInput",
})

const Page = Pagination.Page(Info).annotate({ identifier: "ChannelInstall.Page" })

export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}
export const RemoveInput = Schema.Struct({}).annotate({ identifier: "ChannelInstall.RemoveInput" })

export interface StartInput extends Schema.Schema.Type<typeof StartInput> {}
export const StartInput = Schema.Struct({ provider: Channel.Provider }).annotate({
  identifier: "ChannelInstall.StartInput",
})

export interface ProviderInfo extends Schema.Schema.Type<typeof ProviderInfo> {}
export const ProviderInfo = Schema.Struct({ id: Channel.Provider, title: Schema.String }).annotate({
  identifier: "ChannelInstall.ProviderInfo",
  description: "A provider that this Ren server can install.",
})

export const ProviderInfos = Schema.Struct({ items: Schema.Array(ProviderInfo) }).annotate({
  identifier: "ChannelInstall.ProviderInfos",
})

export const definition = Primitive.define({
  name: "channel-install",
  plural: "channel-installs",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  actions: { remove: { input: RemoveInput, result: Info } },
})
