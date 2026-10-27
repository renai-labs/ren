import type { AppProfileInfo } from "@ren/client"
import { Avatar } from "@ren/ui/avatar"
import { Dialog } from "@ren/ui/dialog"
import { Document } from "@ren/ui/document"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { StatusDot } from "@ren/ui/status-dot"
import type { ReactNode } from "react"
import { Profiles } from "../../components/profiles.js"
import type { Apps } from "../../components/apps.js"

// oxlint-disable-next-line ren/no-comments -- ren-v1 app drawer: the app, its accounts, then what it brings. The Marketplace and a space give their own action and accounts.
export function AppDrawer(props: {
  app: Apps.Entry | undefined
  action?: ReactNode
  children?: ReactNode
  onClose: () => void
}) {
  const app = props.app
  return (
    <Dialog.Root
      open={app !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Content presentation="side" size="large">
        {app ? (
          <>
            <Dialog.Header>
              <div className="flex items-start gap-4 pr-8">
                <Avatar.Root name={app.name} image={app.icon} size="feature" shape="square" imageFit="contain" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Dialog.Title>{app.name}</Dialog.Title>
                  <Dialog.Description>{app.description}</Dialog.Description>
                </div>
                {props.action}
              </div>
            </Dialog.Header>
            <Dialog.Body>
              <div className="flex flex-col gap-8">
                {props.children}
                <Parts title="MCP servers" glyph="Server" parts={app.mcps} />
                <Parts title="Skills" glyph="Skill" parts={app.skills} />
                <About text={app.about} />
                <Parts
                  title="Try asking"
                  glyph="MessageSquare"
                  parts={app.prompts.map((prompt) => ({ slug: prompt, description: "" }))}
                />
              </div>
            </Dialog.Body>
          </>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function AccountList(props: {
  title: string
  actions?: ReactNode
  profiles: ReadonlyArray<AppProfileInfo>
  caption: (profile: AppProfileInfo) => string
  action: (profile: AppProfileInfo) => ReactNode
}) {
  if (props.profiles.length === 0 && !props.actions) return null
  return (
    <List.Root label={props.title}>
      <List.Section title={props.title} appearance="eyebrow" actions={props.actions}>
        {props.profiles.map((profile) => (
          <List.Item
            key={profile.id}
            leading={<Icon glyph={profile.kind === "private" ? "User" : "Users"} />}
            title={profile.name}
            badge={Profiles.gaps(profile).length > 0 ? <StatusDot tone="warning" label="Needs attention" /> : undefined}
            description={props.caption(profile)}
            actionsVisibility="always"
            actions={props.action(profile)}
          />
        ))}
      </List.Section>
    </List.Root>
  )
}

function About(props: { text: string | null }) {
  if (!props.text) return null
  return (
    <List.Section title="About" appearance="eyebrow">
      <div className="px-2">
        <Document.Markdown content={props.text} tone="secondary" />
      </div>
    </List.Section>
  )
}

function Parts(props: {
  title: string
  glyph: Glyph
  parts: ReadonlyArray<{ readonly slug: string; readonly description: string }>
}) {
  if (props.parts.length === 0) return null
  return (
    <List.Root label={props.title}>
      <List.Section title={props.title} appearance="eyebrow">
        {props.parts.map((part) => (
          <List.Item
            key={part.slug}
            leading={<Icon glyph={props.glyph} />}
            title={part.slug}
            {...(part.description && { description: part.description })}
          />
        ))}
      </List.Section>
    </List.Root>
  )
}
