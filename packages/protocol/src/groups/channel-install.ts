import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import { ChannelPlace } from "@ren/schema/channel-place"
import { WriteResult } from "@ren/schema/write-result"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"
import { Primitive } from "../primitive.js"

export const ChannelInstallGroup = Primitive.group(ChannelInstall.definition, "sdk", [
  Primitive.list(ChannelInstall.definition),
  Primitive.update(ChannelInstall.definition),
  Primitive.action(ChannelInstall.definition, "remove"),
])

export const ChannelMappingGroup = Primitive.group(ChannelMapping.definition, "sdk", [
  Primitive.list(ChannelMapping.definition),
  Primitive.create(ChannelMapping.definition),
  Primitive.action(ChannelMapping.definition, "remove"),
])

export const ChannelConnectGroup = HttpApiGroup.make("channel-connect")
  .add(
    HttpApiEndpoint.get("channel-provider.list", "/channel-providers", {
      success: ChannelInstall.ProviderInfos,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "channel-provider.list",
        summary: "List channel providers",
        description: "Return the providers that this Ren server can install: Slack, Linear or GitHub.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("channel-install.start", "/channel-installs/start", {
      payload: ChannelInstall.StartInput,
      success: WriteResult.Redirect,
      error: [NotFoundError, ForbiddenError, ConflictError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "channel-install.start",
        summary: "Start a channel install",
        description:
          "Return the address of the provider’s install page. The provider sends the person back to Ren, which stores the install. An organization has at most one install per provider.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("channel-place.list", "/channel-places", {
      query: ChannelPlace.ListInput,
      success: ChannelPlace.Page,
      error: [NotFoundError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "channel-place.list",
        summary: "List channel places",
        description:
          "Return one page of the places that an install reaches, sorted by name, each with its mapping: Slack channels, Linear projects or GitHub repositories. Ren reads them from the provider.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "channel-connect" }))
