import { ChannelReply } from "@ren/core/channel-reply"
import { InvalidRequestError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ChannelReplyHandler = HttpApiBuilder.group(Api, "channel-reply", (handlers) =>
  Effect.gen(function* () {
    const replies = yield* ChannelReply.Service
    return handlers.handle("channel.reply", (request) =>
      Effect.flatMap(Primitive.currentActor, (actor) => replies.reply(actor, request.payload)).pipe(
        Effect.catchTag("ChannelReply.Refused", (error) =>
          Effect.fail(new InvalidRequestError({ message: error.message })),
        ),
      ),
    )
  }),
)
