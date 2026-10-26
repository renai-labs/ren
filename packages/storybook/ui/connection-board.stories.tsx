import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { ConnectionBoard } from "@ren/ui/connection-board"
import { Icon } from "@ren/ui/icon"
import { Text } from "@ren/ui/text"

const viewport = {
  height: () => window.innerHeight,
  subscribe: (listener: () => void) => {
    window.addEventListener("resize", listener)
    return () => window.removeEventListener("resize", listener)
  },
}

const spaces = [
  { id: "platform", title: "Platform" },
  { id: "billing", title: "Billing" },
  { id: "marketing", title: "Marketing site" },
  { id: "mobile", title: "Mobile app" },
]

const repositories = [
  { id: "web", title: "renai-labs/web" },
  { id: "api", title: "renai-labs/api" },
  { id: "docs", title: "renai-labs/docs" },
  { id: "ios", title: "renai-labs/ios" },
  { id: "infra", title: "renai-labs/infra" },
]

const meta = {
  component: ConnectionBoard,
  args: {
    viewport,
    sources: repositories,
    targets: spaces,
    links: [],
    onConnect: () => undefined,
    onDisconnect: () => undefined,
    sourceLabel: "GitHub repositories",
    sourceNodeIcon: <Icon glyph="GitBranch" />,
    sourceNoun: "repo",
    targetLabel: "Ren space",
    targetNoun: "space",
  },
  render: function Render(args) {
    const [links, setLinks] = useState(args.links)
    const [configuring, setConfiguring] = useState<string | undefined>()
    return (
      <>
        <ConnectionBoard
          {...args}
          links={links}
          onConnect={(sourceId, targetId) =>
            setLinks((current) => [...current.filter((link) => link.sourceId !== sourceId), { sourceId, targetId }])
          }
          onDisconnect={(sourceId) => setLinks((current) => current.filter((link) => link.sourceId !== sourceId))}
          onConfigure={args.onConfigure ? setConfiguring : undefined}
        />
        {configuring ? (
          <Text purpose="body" element="p">
            Configuring {repositories.find((repository) => repository.id === configuring)?.title}
          </Text>
        ) : null}
      </>
    )
  },
} satisfies Meta<typeof ConnectionBoard>

export default meta

type Story = StoryObj<typeof meta>

const links = [
  { sourceId: "web", targetId: "platform" },
  { sourceId: "api", targetId: "billing" },
]

export const Empty: Story = { args: { sources: [], targets: [] } }
export const Unrouted: Story = {}
export const WithLinks: Story = { args: { links } }
export const Configurable: Story = { args: { links, onConfigure: () => undefined } }
export const Busy: Story = { args: { links, busy: true } }
export const SharedTargets: Story = {
  args: {
    links: [...links, { sourceId: "docs", targetId: "platform" }],
    targetSharing: "shared",
  },
}
