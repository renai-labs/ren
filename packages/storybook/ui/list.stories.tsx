import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { IconButton } from "@ren/ui/icon-button"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { Text } from "@ren/ui/text"

type File = { title: string; description: string; glyph: Glyph }

const files: ReadonlyArray<File> = [
  { title: "README.md", description: "Updated 2 hours ago", glyph: "FileText" },
  { title: "release-notes.md", description: "Updated yesterday", glyph: "FileText" },
  { title: "assets", description: "12 files", glyph: "Folder" },
]

const fileRows = (row: (file: File, index: number) => Omit<List.ItemProps, "title">) =>
  files.map((file, index) => <List.Item key={file.title} title={file.title} {...row(file, index)} />)

const rows = fileRows((file) => ({ description: file.description }))

const openButton = (
  <Button appearance="plain" size="small">
    Open
  </Button>
)

const meta = {
  component: List.Root,
  args: { label: "Files", children: rows },
  decorators: [
    (Story) => (
      <div className="w-96 p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof List.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Plain: Story = {}
export const CardFrame: Story = { args: { frame: "card" } }
export const Divided: Story = { args: { frame: "divided" } }
export const Ruled: Story = { args: { frame: "ruled" } }
export const Flush: Story = { args: { frame: "flush" } }
export const LimitedHeight: Story = {
  args: {
    height: "limited",
    children: Array.from({ length: 16 }, (_, index) => `Session ${index + 1}`).map((title) => (
      <List.Item key={title} title={title} onActivate={() => undefined} />
    )),
  },
}
export const Compact: Story = { args: { children: fileRows(() => ({ density: "compact" })) } }
export const Spacious: Story = {
  args: {
    frame: "divided",
    children: fileRows((file) => ({
      density: "spacious",
      leading: <Icon glyph={file.glyph} />,
      description: file.description,
    })),
  },
}
export const InlineDescription: Story = {
  args: { children: fileRows((file) => ({ description: file.description, descriptionPlacement: "inline" })) },
}
export const Details: Story = {
  args: {
    children: fileRows((file) => ({ titleWeight: "medium", badge: <Badge>main</Badge>, trailing: file.description })),
  },
}
export const Buttons: Story = {
  args: {
    children: fileRows((file, index) => ({
      description: file.description,
      selected: index === 1,
      disabled: index === 2,
      onActivate: () => undefined,
    })),
  },
}
export const Links: Story = {
  args: {
    children: fileRows((file, index) => ({
      selected: index === 0,
      render: <a href={`#${file.title}`} aria-label={file.title} />,
    })),
  },
}
export const Checkboxes: Story = { render: (args) => <Selectable {...args} kind="checkbox" /> }
export const Radios: Story = { render: (args) => <Selectable {...args} kind="radio" /> }
export const Actions: Story = {
  args: {
    children: fileRows((file) => ({
      description: file.description,
      onActivate: () => undefined,
      actionsVisibility: "always",
      actions: (
        <IconButton label={`Remove ${file.title}`}>
          <Icon glyph="Trash2" />
        </IconButton>
      ),
    })),
  },
}
export const HoverActions: Story = { args: { children: fileRows(() => ({ actions: openButton })) } }
export const Disclosure: Story = {
  args: {
    frame: "divided",
    children: (
      <>
        <List.DisclosureItem
          density="spacious"
          leading={<Icon glyph="Key" />}
          title="GitHub"
          trailing="2/3"
          defaultOpen
        >
          <List.Item density="compact" title="Personal access token" />
          <List.Item density="compact" title="Webhook secret" />
        </List.DisclosureItem>
        <List.DisclosureItem density="spacious" leading={<Icon glyph="Lock" />} title="Linear" trailing="1/1">
          <List.Item density="compact" title="API key" />
        </List.DisclosureItem>
      </>
    ),
  },
}
export const Transcript: Story = {
  args: {
    children: (
      <>
        <List.TranscriptItem
          leading={<Icon glyph="Search" />}
          title="Searched the codebase"
          description="useVirtualizer"
          trailing="0.4s"
        />
        <List.TranscriptDisclosure
          leading={<Icon glyph="Pencil" />}
          title="Edited list.tsx"
          description="+12 −4"
          defaultOpen
        >
          <Text purpose="code">export function Root(props: RootProps)</Text>
        </List.TranscriptDisclosure>
        <List.TranscriptItem leading={<Icon glyph="Clock" />} title="Waiting for review" onActivate={() => undefined} />
      </>
    ),
  },
}
export const TranscriptActions: Story = {
  args: {
    children: (
      <>
        <List.TranscriptDisclosure
          leading={<Icon glyph="Pencil" />}
          title="Edited list.tsx"
          description="+12 −4"
          trailing="0.8s"
          actions={
            <IconButton label="Copy diff" size="compact">
              <Icon glyph="Copy" />
            </IconButton>
          }
        >
          <Text purpose="code">export function Root(props: RootProps)</Text>
        </List.TranscriptDisclosure>
        <List.TranscriptItem leading={<Icon glyph="Clock" />} title="Waiting for review" onActivate={() => undefined} />
      </>
    ),
  },
}
export const Summary: Story = {
  args: {
    children: (
      <List.TranscriptDisclosure appearance="summary" title="Worked for 2 minutes" defaultOpen>
        <List.TranscriptItem leading={<Icon glyph="Search" />} title="Searched the codebase" />
        <List.TranscriptItem leading={<Icon glyph="Pencil" />} title="Edited list.tsx" />
      </List.TranscriptDisclosure>
    ),
  },
}
export const Events: Story = {
  args: {
    children: (
      <>
        <List.TranscriptItem appearance="event" leading={<Icon glyph="User" />} title="Shrey created the task" />
        <List.TranscriptItem appearance="event" leading={<Icon glyph="GitBranch" />} title="Ren opened a branch" />
      </>
    ),
  },
}
export const Sections: Story = {
  args: {
    children: (
      <>
        <List.Section title="Recent">{rows.slice(0, 2)}</List.Section>
        <List.Section title="Folders" appearance="eyebrow">
          {rows.slice(2)}
        </List.Section>
      </>
    ),
  },
}
export const Group: Story = {
  render: () => (
    <List.Group
      label="In progress"
      title="In progress"
      leading={<Icon glyph="Clock" tone="accent" />}
      meta={<Text purpose="caption">3</Text>}
      actions={
        <IconButton label="Add a task to In progress" size="compact">
          <Icon glyph="Plus" />
        </IconButton>
      }
    >
      {rows}
    </List.Group>
  ),
}
export const GroupCollapsed: Story = {
  render: () => (
    <List.Group label="Done" title="Done" defaultOpen={false}>
      {rows}
    </List.Group>
  ),
}
export const Loading: Story = { args: { frame: "divided", state: "loading" } }
export const Empty: Story = { args: { frame: "divided", state: "empty", emptyMessage: "No files yet." } }
export const Failed: Story = {
  args: { frame: "divided", state: "failed", failureMessage: "Couldn't load files.", onRetry: () => undefined },
}

const sessions = Array.from({ length: 2000 }, (_, index) => ({
  id: `session-${index + 1}`,
  title: `Session ${index + 1}`,
  description: `Updated ${(index % 59) + 1} minutes ago`,
}))

export const Virtual: Story = {
  decorators: [
    (Story) => (
      <div className="flex h-96 flex-col">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <List.Virtual
      label="Sessions"
      frame="divided"
      items={sessions}
      itemKey={(session) => session.id}
      estimateSize={57}
      // ast-grep-ignore: no-render-props, -- the virtualized list hands each session back
      renderItem={(session) => (
        <List.Item title={session.title} description={session.description} onActivate={() => undefined} />
      )}
    />
  ),
}

function Selectable(props: List.RootProps & { kind: "checkbox" | "radio" }) {
  const [chosen, setChosen] = useState(["README.md"])
  const toggle = (title: string) =>
    setChosen((previous) => {
      if (props.kind === "radio") return [title]
      return previous.includes(title) ? previous.filter((entry) => entry !== title) : [...previous, title]
    })
  return (
    <List.Root label={props.label} frame="divided">
      {fileRows((file) => ({
        selectionMark: props.kind,
        selected: chosen.includes(file.title),
        onActivate: () => toggle(file.title),
      }))}
    </List.Root>
  )
}
