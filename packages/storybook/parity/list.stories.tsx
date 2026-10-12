import type { ComponentProps } from "react"
import { useState } from "react"
import { List, ListItem, ListSection } from "ren-v1/composites/list"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { IconButton } from "@ren/ui/icon-button"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Text } from "@ren/ui/text"
import meta from "../ui/list.stories.js"

type Args = ComponentProps<typeof List>

const files: ReadonlyArray<{ title: string; description: string; glyph: Glyph }> = [
  { title: "README.md", description: "Updated 2 hours ago", glyph: "FileText" },
  { title: "release-notes.md", description: "Updated yesterday", glyph: "FileText" },
  { title: "assets", description: "12 files", glyph: "Folder" },
]

const rows = files.map((file) => <ListItem key={file.title} title={file.title} description={file.description} />)

export default { ...meta, component: List, args: { label: "Files", children: rows } }

export { Plain, CardFrame, Divided, Ruled, Loading, Failed } from "../ui/list.stories.js"

export const Compact = {
  args: { children: files.map((file) => <ListItem key={file.title} density="compact" title={file.title} />) },
}
export const Spacious = {
  args: {
    frame: "divided",
    children: files.map((file) => (
      <ListItem
        key={file.title}
        density="spacious"
        leading={<Icon glyph={file.glyph} />}
        title={file.title}
        description={file.description}
      />
    )),
  },
}
export const InlineDescription = {
  args: {
    children: files.map((file) => (
      <ListItem key={file.title} title={file.title} description={file.description} descriptionPlacement="inline" />
    )),
  },
}
export const Details = {
  args: {
    children: files.map((file) => (
      <ListItem
        key={file.title}
        title={file.title}
        titleWeight="medium"
        badge={<Badge>main</Badge>}
        trailing={file.description}
      />
    )),
  },
}
export const Buttons = {
  args: {
    children: files.map((file, index) => (
      <ListItem
        key={file.title}
        title={file.title}
        description={file.description}
        selected={index === 1}
        disabled={index === 2}
        onActivate={() => undefined}
      />
    )),
  },
}
export const Links = {
  args: {
    children: files.map((file, index) => (
      <ListItem
        key={file.title}
        title={file.title}
        selected={index === 0}
        linkElement={<a href={`#${file.title}`} />}
      />
    )),
  },
}
export const Checkboxes = {
  render: function Render(args: Args) {
    const [chosen, setChosen] = useState(["README.md"])
    return (
      <List {...args} frame="divided">
        {files.map((file) => (
          <ListItem
            key={file.title}
            selectionMark="checkbox"
            title={file.title}
            selected={chosen.includes(file.title)}
            onActivate={() => setChosen([...chosen, file.title])}
          />
        ))}
      </List>
    )
  },
}
export const Radios = {
  render: function Render(args: Args) {
    const [chosen, setChosen] = useState("README.md")
    return (
      <List {...args} frame="divided">
        {files.map((file) => (
          <ListItem
            key={file.title}
            selectionMark="radio"
            title={file.title}
            selected={chosen === file.title}
            onActivate={() => setChosen(file.title)}
          />
        ))}
      </List>
    )
  },
}
export const Actions = {
  args: {
    children: files.map((file) => (
      <ListItem
        key={file.title}
        title={file.title}
        description={file.description}
        onActivate={() => undefined}
        actionsVisibility="always"
        actions={
          <IconButton label={`Remove ${file.title}`}>
            <Icon glyph="Trash2" />
          </IconButton>
        }
      />
    )),
  },
}
export const HoverActions = {
  args: {
    children: files.map((file) => (
      <ListItem
        key={file.title}
        title={file.title}
        actions={
          <Button appearance="plain" size="small">
            Open
          </Button>
        }
      />
    )),
  },
}
export const Disclosure = {
  args: {
    frame: "divided",
    children: (
      <>
        <ListItem
          density="spacious"
          leading={<Icon glyph="Key" />}
          title="GitHub"
          trailing="2/3"
          detailOpen
          onDetailOpenChange={() => undefined}
          detail={
            <>
              <ListItem density="compact" title="Personal access token" />
              <ListItem density="compact" title="Webhook secret" />
            </>
          }
        />
        <ListItem
          density="spacious"
          leading={<Icon glyph="Lock" />}
          title="Linear"
          trailing="1/1"
          detail={<ListItem density="compact" title="API key" />}
        />
      </>
    ),
  },
}
export const Transcript = {
  args: {
    children: (
      <>
        <ListItem
          appearance="transcript"
          leading={<Icon glyph="Search" />}
          title="Searched the codebase"
          description="useVirtualizer"
          trailing="0.4s"
        />
        <ListItem
          appearance="transcript"
          leading={<Icon glyph="Pencil" />}
          title="Edited list.tsx"
          description="+12 −4"
          detailOpen
          onDetailOpenChange={() => undefined}
          detail={<Text purpose="code">export function Root(props: RootProps)</Text>}
        />
        <ListItem
          appearance="transcript"
          leading={<Icon glyph="Clock" />}
          title="Waiting for review"
          onActivate={() => undefined}
        />
      </>
    ),
  },
}
export const Summary = {
  args: {
    children: (
      <ListItem
        appearance="summary"
        title="Worked for 2 minutes"
        detailOpen
        onDetailOpenChange={() => undefined}
        detail={
          <>
            <ListItem appearance="transcript" leading={<Icon glyph="Search" />} title="Searched the codebase" />
            <ListItem appearance="transcript" leading={<Icon glyph="Pencil" />} title="Edited list.tsx" />
          </>
        }
      />
    ),
  },
}
export const Events = {
  args: {
    children: (
      <>
        <ListItem appearance="event" leading={<Icon glyph="User" />} title="Shrey created the task" />
        <ListItem appearance="event" leading={<Icon glyph="GitBranch" />} title="Ren opened a branch" />
      </>
    ),
  },
}
export const Sections = {
  args: {
    children: (
      <>
        <ListSection title="Recent">{rows.slice(0, 2)}</ListSection>
        <ListSection title="Folders" appearance="eyebrow">
          {rows.slice(2)}
        </ListSection>
      </>
    ),
  },
}
export const Group = {
  args: {
    children: (
      <ListSection
        appearance="banded"
        label="In progress"
        title="In progress"
        leading={
          <>
            <IconButton size="compact" aria-expanded label="Collapse In progress">
              <Icon glyph="ChevronDown" />
            </IconButton>
            <Icon glyph="Clock" tone="accent" />
          </>
        }
        meta={<Text purpose="caption">3</Text>}
        actions={
          <IconButton label="Add a task to In progress" size="compact">
            <Icon glyph="Plus" />
          </IconButton>
        }
      >
        {rows}
      </ListSection>
    ),
  },
}
export const GroupCollapsed = {
  args: {
    children: (
      <ListSection
        appearance="banded"
        label="Done"
        title="Done"
        leading={
          <IconButton size="compact" aria-expanded={false} label="Expand Done">
            <Icon glyph="ChevronRight" />
          </IconButton>
        }
      />
    ),
  },
}
export const Empty = { args: { frame: "divided", empty: true, emptyMessage: "No files yet." } }
