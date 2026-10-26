import { ChannelReply } from "@ren/chat"
import { Channel } from "@ren/schema/channel"
import type { ChannelOrigin } from "@ren/schema/channel-origin"
import type { SessionMessage } from "@ren/schema/session/message"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Disclosure } from "@ren/ui/disclosure"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Link } from "@ren/ui/link"
import { Text } from "@ren/ui/text"
import { Transcript } from "@ren/ui/transcript"

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
    <div className="flex min-w-0 flex-col gap-1 pb-2">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Icon glyph={glyphs[origin.provider]} size="small" tone="secondary" />
        <Text purpose="caption" tone="secondary" element="span" wrapping="anywhere">
          Sent from {title} by {senderOf(origin)} in {origin.place}
        </Text>
        {origin.threadUrl ? (
          <Text purpose="caption" element="span">
            <Link appearance="quiet" href={origin.threadUrl} external>
              Open on {title}
            </Link>
          </Text>
        ) : null}
      </span>
      {origin.context ? (
        <Disclosure summary="Included context">
          <Text purpose="caption" tone="secondary" element="p" wrapping="preserved">
            {origin.context}
          </Text>
        </Disclosure>
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
    <ConversationShell.Message author="assistant">
      <span className="flex items-center gap-2">
        {reply.sent ? <Icon glyph={glyphs[reply.sent.provider]} size="small" tone="secondary" /> : null}
        <Text purpose="caption" tone="secondary" element="span">
          {reply.sent ? `Sent on ${Channel.titles[reply.sent.provider]}` : "Sending to the thread…"}
        </Text>
      </span>
      <Transcript.Response content={reply.text} streaming={false} onOpenSession={props.onOpenSession} />
    </ConversationShell.Message>
  )
}
