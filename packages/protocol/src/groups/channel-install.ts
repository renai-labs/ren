import { ChannelInstall } from "@ren/schema/channel-install"
import { WriteResult } from "@ren/schema/write-result"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"
import { Primitive } from "../primitive.js"

export const ChannelInstallGroup = Primitive.group(ChannelInstall.definition, "sdk", [
  Primitive.list(ChannelInstall.definition),
  Primitive.action(ChannelInstall.definition, "remove"),
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
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "channel-connect" }))
