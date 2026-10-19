import { ConversationShell } from "ren-v1/shells/conversation-shell"
import { Avatar } from "@ren/ui/avatar"
import { Badge } from "@ren/ui/badge"
import { Document } from "@ren/ui/document"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { Separator } from "@ren/ui/separator"
import { Text } from "@ren/ui/text"
import meta from "../ui/conversation-shell.stories.js"

export default { ...meta, component: ConversationShell }

const answer = `The report is ready. Revenue grew **12%** this quarter, led by the enterprise plan.

- Churn fell from 3.1% to 2.4%
- Expansion revenue doubled in the EMEA region`

function Composer(props: { layout?: "stacked" | "inline"; disabled?: boolean; dropping?: boolean }) {
  return (
    <>
      <ConversationShell.Composer
        layout={props.layout}
        dropIndicator={props.dropping ? "Drop files to attach them" : undefined}
        onSubmit={() => undefined}
        trailing={
          <IconButton type="submit" appearance="primary" shape="circle" size="medium" label="Send">
            <Icon glyph="ArrowUp" />
          </IconButton>
        }
        footerTrailing={
          <IconButton
            type="submit"
            appearance="secondary"
            shape="circle"
            size="medium"
            label="Send"
            disabled={props.disabled}
          >
            <Icon glyph="ArrowUp" />
          </IconButton>
        }
      >
        <ConversationShell.ComposerInput
          aria-label="Message"
          placeholder="Summarise last quarter’s revenue"
          value=""
          onChange={() => undefined}
        />
      </ConversationShell.Composer>
      <output aria-label="Sent messages" />
    </>
  )
}

const transcript = (
  <>
    <ConversationShell.Message author="user" sender="Ada Lovelace" avatar={<Avatar.Root name="Ada Lovelace" />}>
      <ConversationShell.Bubble>
        <Text>Draft the quarterly report from the finance sheet.</Text>
      </ConversationShell.Bubble>
    </ConversationShell.Message>
    <ConversationShell.Message author="assistant">
      <List.Root>
        <List.TranscriptDisclosure appearance="summary" title="Worked for 1m 12s">
          <List.TranscriptItem leading={<Icon glyph="Search" />} title="Read finance.xlsx" />
          <List.TranscriptItem leading={<Icon glyph="Pencil" />} title="Wrote report.md" />
        </List.TranscriptDisclosure>
      </List.Root>
      <Document.Markdown content={answer} scale="standard" />
    </ConversationShell.Message>
    <Separator label="Compaction" />
    <ConversationShell.Message
      author="user"
      sender="Grace Hopper"
      avatar={<Avatar.Root name="Grace Hopper" />}
      badge={<Badge size="small">Queued</Badge>}
    >
      <ConversationShell.Bubble>
        <Text>Add a chart of monthly revenue.</Text>
      </ConversationShell.Bubble>
    </ConversationShell.Message>
  </>
)

export const Conversation = { args: { transcript, composer: <Composer /> } }
export const Empty = {
  args: {
    populated: false,
    transcript: undefined,
    composer: <Composer />,
    composerPosition: "centered",
    placeholder: <Text purpose="heading">What should Ren work on?</Text>,
  },
}
export const Latest = {
  render: () => (
    <>
      <ConversationShell
        populated
        transcript={transcript}
        composer={<Composer />}
        latest={{ visible: true, onActivate: () => undefined }}
      />
      <output aria-label="Jumps">0</output>
    </>
  ),
}
export const Actions = {
  args: {
    composer: <Composer />,
    transcript: (
      <ConversationShell.Message
        author="assistant"
        actionSpace="reserved"
        actions={
          <IconButton label="Copy message" size="compact">
            <Icon glyph="Copy" />
          </IconButton>
        }
      >
        <Document.Markdown content={answer} scale="standard" />
      </ConversationShell.Message>
    ),
  },
}
export const Interaction = {
  args: {
    transcript,
    composer: <Composer />,
    interaction: (
      <Text purpose="caption" tone="danger" element="div" role="alert">
        The session stopped. Send a message to start it again.
      </Text>
    ),
  },
}
export const InlineComposer = { args: { transcript, composer: <Composer layout="inline" /> } }
export const DisabledSend = { args: { transcript, composer: <Composer disabled /> } }
export const Dropping = { args: { transcript, composer: <Composer dropping /> } }
export const Hidden = {
  args: {
    transcript,
    composer: <Composer />,
    hidden: true,
    overlay: <Text purpose="heading">Subagent transcript</Text>,
  },
}
export const Auxiliary = {
  args: { transcript, composer: <Composer />, auxiliary: <Text purpose="heading">Artifacts</Text> },
}
