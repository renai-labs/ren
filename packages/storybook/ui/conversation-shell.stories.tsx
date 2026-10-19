import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Avatar } from "@ren/ui/avatar"
import { Badge } from "@ren/ui/badge"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Document } from "@ren/ui/document"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { Separator } from "@ren/ui/separator"
import { Text } from "@ren/ui/text"

const answer = `The report is ready. Revenue grew **12%** this quarter, led by the enterprise plan.

- Churn fell from 3.1% to 2.4%
- Expansion revenue doubled in the EMEA region`

function Composer(props: { layout?: ConversationShell.ComposerLayout; disabled?: boolean; dropping?: boolean }) {
  const [draft, setDraft] = useState("")
  const [sent, setSent] = useState<ReadonlyArray<string>>([])
  return (
    <>
      <ConversationShell.Composer
        label="Message Ren"
        layout={props.layout}
        dropIndicator={props.dropping ? "Drop files to attach them" : undefined}
        onSubmit={() => {
          setSent((current) => [...current, draft])
          setDraft("")
        }}
        trailing={
          <IconButton type="submit" appearance="primary" shape="circle" size="medium" label="Send">
            <Icon glyph="ArrowUp" />
          </IconButton>
        }
        footerTrailing={
          <IconButton
            type="submit"
            appearance={draft ? "primary" : "secondary"}
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
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </ConversationShell.Composer>
      <output aria-label="Sent messages">{sent.join(" | ")}</output>
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

const meta = {
  component: ConversationShell.Root,
  args: {
    populated: true,
    transcript,
    composer: <Composer />,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="flex h-180 w-240 flex-col overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConversationShell.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Conversation: Story = {}
export const Empty: Story = {
  args: {
    populated: false,
    transcript: undefined,
    composerPosition: "centered",
    placeholder: <Text purpose="heading">What should Ren work on?</Text>,
  },
}
export const Latest: Story = {
  render: function Render(args) {
    const [jumps, setJumps] = useState(0)
    return (
      <>
        <ConversationShell.Root
          {...args}
          latest={{ visible: true, onActivate: () => setJumps((count) => count + 1) }}
        />
        <output aria-label="Jumps">{jumps}</output>
      </>
    )
  },
}
export const Actions: Story = {
  args: {
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
export const Interaction: Story = {
  args: {
    interaction: (
      <Text purpose="caption" tone="danger" element="div" role="alert">
        The session stopped. Send a message to start it again.
      </Text>
    ),
  },
}
export const InlineComposer: Story = { args: { composer: <Composer layout="inline" /> } }
export const DisabledSend: Story = { args: { composer: <Composer disabled /> } }
export const Dropping: Story = { args: { composer: <Composer dropping /> } }
export const Hidden: Story = {
  args: { hidden: true, overlay: <Text purpose="heading">Subagent transcript</Text> },
}
export const Auxiliary: Story = {
  args: { auxiliary: <Text purpose="heading">Artifacts</Text> },
}
