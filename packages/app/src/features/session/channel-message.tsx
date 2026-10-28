import { ChannelReply } from "@ren/chat"
import { Channel } from "@ren/schema/channel"
import type { ChannelOrigin } from "@ren/schema/channel-origin"
import type { SessionMessage } from "@ren/schema/session/message"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Link } from "@ren/ui/link"
import { Markdown } from "@ren/ui/markdown"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { Message, MessageContent, MessageHeader } from "@ren/ui/message"
import { IconChevronRight } from "@tabler/icons-react"

const glyphs: Readonly<Record<Channel.Provider, Glyph>> = { github: "Github", slack: "Slack", linear: "Linear" }

const senderOf = (origin: ChannelOrigin.Info) => {
  if (!origin.handle) return origin.sender
  if (origin.handle === origin.sender) return `@${origin.handle}`
  return `${origin.sender} (@${origin.handle})`
}

export function ChannelMessageHeader(props: { origin: ChannelOrigin.Info | undefined }) {
  const origin = props.origin
  if (!origin) return null
  const title = Channel.titles[origin.provider]
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <Marker className="justify-end text-xs">
        <MarkerIcon>
          <Icon glyph={glyphs[origin.provider]} size="small" />
        </MarkerIcon>
        <MarkerContent>
          {origin.trigger
            ? `Started on ${title} by “${origin.trigger}” in ${origin.place}, for ${senderOf(origin)}`
            : `Sent from ${title} by ${senderOf(origin)} in ${origin.place}`}
          {origin.threadUrl ? (
            <>
              {" · "}
              <Link href={origin.threadUrl} external>
                Open on {title}
              </Link>
            </>
          ) : null}
        </MarkerContent>
      </Marker>
      {origin.context ? (
        <Collapsible className="flex min-w-0 flex-col items-end">
          <CollapsibleTrigger className="group/context flex items-center gap-1 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            Included context
            <IconChevronRight className="size-3.5 transition-transform group-aria-expanded/context:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">{origin.context}</p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

export function ChannelReplyMessage(props: {
  tool: SessionMessage.Tool
  onOpenSession: ((sessionID: string) => void) | undefined
}) {
  const reply = ChannelReply.of(props.tool)
  return (
    <Message>
      <MessageContent>
        <MessageHeader className="gap-2 px-0">
          {reply.sent ? <Icon glyph={glyphs[reply.sent.provider]} size="small" /> : null}
          {reply.sent ? `Sent on ${Channel.titles[reply.sent.provider]}` : "Sending to the thread…"}
        </MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent>
            <Markdown size="lg" onOpenSession={props.onOpenSession}>
              {reply.text}
            </Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
