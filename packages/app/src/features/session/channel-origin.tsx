import type { SessionMessage } from "@ren/schema/session/message"
import { Channel } from "@ren/schema/channel"
import { Link } from "@ren/ui/link"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { ChannelMark } from "../../components/channel-mark.js"

type Origin = NonNullable<SessionMessage.User["channel"]>

function senderOf(origin: Origin) {
  if (!origin.handle) return origin.sender
  return origin.handle === origin.sender ? `@${origin.handle}` : `${origin.sender} (@${origin.handle})`
}

export function ChannelOrigin(props: { origin: Origin }) {
  const origin = props.origin
  const title = Channel.titles[origin.provider]
  const sender = senderOf(origin)
  return (
    <Marker className="justify-end text-xs">
      <MarkerIcon>
        <ChannelMark provider={origin.provider} className="size-4" />
      </MarkerIcon>
      <MarkerContent>
        {origin.trigger
          ? `Started on ${title} by “${origin.trigger}” in ${origin.place}, for ${sender}`
          : `Sent from ${title} by ${sender} in ${origin.place}`}
        {origin.threadUrl ? (
          <>
            {" · "}
            <Link href={origin.threadUrl} external appearance="plain">
              Open on {title}
            </Link>
          </>
        ) : null}
      </MarkerContent>
    </Marker>
  )
}
