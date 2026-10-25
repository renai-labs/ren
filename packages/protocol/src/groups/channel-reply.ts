import { Channel } from "@ren/schema/channel"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { Mcp } from "../mcp.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const ChannelReplyGroup = HttpApiGroup.make("channel-reply")
  .add(
    HttpApiEndpoint.post("channel.reply", "/channel-replies", {
      payload: Channel.ReplyInput,
      success: Channel.Sent,
      error: InvalidRequestError,
    })
      .annotate(Mcp.Tool, true)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "channel.reply",
          summary: "Reply in the thread",
          description:
            "Answer the person in the Slack, Linear or GitHub thread this chat came from. Plain text in the chat is not sent.",
        }),
      ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "internal")
  .annotateMerge(OpenApi.annotations({ title: "channel-reply" }))
