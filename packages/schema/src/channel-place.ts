export * as ChannelPlace from "./channel-place.js"

import { Schema } from "effect"
import { ChannelInstall } from "./channel-install.js"
import { ChannelMapping } from "./channel-mapping.js"
import { Pagination } from "./pagination.js"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.String.annotate({
    description: "The provider’s id of the place: a Slack channel, a Linear project, a GitHub repository.",
  }),
  name: Schema.String,
  private: Schema.Boolean,
  anyoneCanWrite: Schema.Boolean.annotate({
    description:
      "People outside the install’s workspace can write there, as on a public GitHub repository. A new mapping of an open place starts with the fallback off.",
  }),
  description: Schema.optionalKey(
    Schema.String.annotate({ description: "The provider’s description of the place, such as a GitHub repository’s." }),
  ),
  mapping: Schema.NullOr(ChannelMapping.Info),
}).annotate({ identifier: "ChannelPlace.Info", description: "A place that an install reaches." })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  installId: ChannelInstall.ID,
  ...Pagination.fields(100),
}).annotate({ identifier: "ChannelPlace.ListInput" })

export const Page = Pagination.Page(Info).annotate({ identifier: "ChannelPlace.Page" })
export type Page = typeof Page.Type
