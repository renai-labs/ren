import { AppDetailSample } from "./app-detail.js"
import { AppListingSample } from "./app-list.js"
import { Loading } from "@ren/ui/loading"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Switch } from "@ren/ui/switch"
import { Channels } from "../lib/channels.js"
import { Routing } from "../lib/routing.js"
import { inboxColumns } from "../lib/sessions.js"
import { ChannelMark } from "./channel-mark.js"
import { Textarea } from "@ren/ui/textarea"
import { IconCircle, IconChevronDown } from "@tabler/icons-react"
import { ChatSkeleton, ComposerFrame } from "./chat-skeleton.js"
import { Logomark } from "../icons/logomark.js"
import { PersonAvatar } from "./person-avatar.js"
import { PermissionRulesSample } from "./permission-rules.js"
import { Page, PageSkeleton, Row, Rows, RowsSample, Section, TableSample, useShapeId, type PageWidth } from "./page.js"

type SpaceSection = { title: string; description?: (space: string) => string; width?: PageWidth }

export const spaceSections: Readonly<Record<string, SpaceSection>> & { readonly inbox: SpaceSection } = {
  inbox: { title: "Inbox", width: "full" },
  overview: { title: "Overview", width: "full" },
  tasks: { title: "Tasks", width: "full" },
  drive: { title: "Drive", width: "full" },
  automations: { title: "Automations", width: "full" },
  agents: { title: "Agents", description: (space) => `Agents that work in ${space}.` },
  instructions: { title: "Instructions", description: (space) => `Guidance every agent follows in ${space}.` },
  memory: {
    title: "Memory",
    description: (space) => `What agents remember between chats in ${space}.`,
    width: "full",
  },
  permissions: {
    title: "Permissions",
    description: (space) => `Tools agents in ${space} can use, and which ones ask first.`,
  },
  settings: {
    title: "Settings",
    description: (space) => `The name, description and default model of ${space}.`,
  },
  compute: { title: "Compute", description: (space) => `Machines for ${space}’s brain and tools.` },
  members: { title: "Members", description: (space) => `People who can use ${space}.` },
  apps: { title: "Apps", description: (space) => `Apps every chat in ${space} can use.` },
  repositories: { title: "Repositories", description: (space) => `Repositories Ren can read in ${space}.` },
  channels: { title: "Channels", description: (space) => `Where people mention @Ren to work in ${space}.` },
  credentials: { title: "Secrets", description: (space) => `Secrets every chat in ${space} can use.` },
}

export function TasksSample() {
  return (
    <div className="flex flex-col">
      {["Backlog", "In progress"].map((title) => (
        <div key={title}>
          <div className="flex h-9 items-center gap-2 rounded-lg bg-muted pr-2 pl-1 text-sm">
            <Button variant="ghost" size="icon-sm" aria-label={`Toggle ${title}`}>
              <IconChevronDown />
            </Button>
            <IconCircle className="size-4" />
            <h2 className="truncate font-medium">{title}</h2>
            <span className="text-xs text-muted-foreground tabular-nums">4</span>
          </div>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex h-11 items-center gap-2 rounded-lg px-2 text-sm">
              <span className="mx-1 size-3.5" />
              <span className="ml-2 min-w-20 shrink-0 font-mono text-xs text-muted-foreground">REN-{index + 1}</span>
              <IconCircle className="size-4" />
              <span className="ml-2 min-w-0 truncate font-medium">Task title for the team</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function TaskSkeleton() {
  return (
    <Loading label="Loading task" className="flex-1">
      <div className="flex min-h-full flex-col gap-8 p-8 lg:flex-row">
        <article className="flex flex-1 flex-col gap-6">
          <h1 className="text-2xl font-semibold">Task title</h1>
          <p>Task description and details.</p>
          <h2 className="text-sm font-medium">Activity</h2>
          <p className="text-sm text-muted-foreground">Task activity</p>
        </article>
        <aside className="flex w-64 flex-col gap-6 text-sm">
          {["Status", "Priority", "Assignee", "Space", "Labels"].map((title) => (
            <div key={title} className="flex flex-col gap-2">
              <span>{title}</span>
              <span className="text-muted-foreground">Task property</span>
            </div>
          ))}
        </aside>
      </div>
    </Loading>
  )
}

function TasksSkeleton() {
  return (
    <PageSkeleton title="Tasks" width="full" shape="tasks-first-load" actions={<div className="min-h-8" />}>
      <TasksSample />
    </PageSkeleton>
  )
}

function SettingsSample() {
  return (
    <>
      <Rows>
        {[
          <Row key="name" title="Name">
            <span className="flex items-center gap-3">
              <PersonAvatar name="Organization" />
              <span className="text-sm">Organization</span>
            </span>
          </Row>,
          <Row key="model" title="Default model" description="New chats start with it unless a space sets its own.">
            <Button variant="ghost">
              Choose model
              <IconChevronDown />
            </Button>
          </Row>,
        ]}
      </Rows>
      <Section
        title="Instructions"
        description="Shared guidance for every agent in your organization. Spaces can add their own."
      >
        <Textarea
          readOnly
          aria-label="Instructions"
          placeholder="Instructions for your agents"
          className="min-h-110 rounded-xl bg-card p-4 dark:bg-card"
        />
        <p className="text-xs text-muted-foreground">Changes save automatically.</p>
      </Section>
    </>
  )
}

function SpaceSectionSample(props: { section: string }) {
  const table = (columns: ReadonlyArray<string>) => <TableSample columns={columns} count={3} />
  if (props.section === "permissions") return <PermissionRulesSample />
  if (props.section === "members") return table(["Name", "Email", "Status", ""])
  if (props.section === "credentials") return table(["Secret", "Hosts", "Owner", ""])
  if (props.section === "repositories") return table(["Repository", "Description", ""])
  if (props.section === "apps") return table(["App", "Used in", "Status", ""])
  if (props.section === "automations") return table(["Name", "Frequency", "Last run", "Next run", "Status", ""])
  if (props.section === "channels") return table(["Channel", "Provider", ""])
  if (props.section === "agents") return table(["Name", "Type", "Model", "Source", ""])
  if (props.section === "inbox") return table(inboxColumns)
  if (props.section === "instructions")
    return (
      <Textarea
        readOnly
        aria-label="Space instructions"
        placeholder="Instructions for your agents"
        className="min-h-110 rounded-xl bg-card p-4 dark:bg-card"
      />
    )
  return <RowsSample count={2} />
}

export function SpaceSectionSkeleton() {
  const path = Routing.useRenderedPath()
  const shapeId = useShapeId("page")
  const parts = path.split("/")
  if (parts.at(3) === "tasks") return parts.at(4) ? <TaskSkeleton /> : <TasksSkeleton />
  return (
    <Loading id={shapeId} label="Loading space">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-8">
          <SpaceSectionSample section={parts.at(3) ?? "inbox"} />
        </div>
      </div>
    </Loading>
  )
}

function SpaceRouteSkeleton(props: { path: ReadonlyArray<string> }) {
  const tab = props.path.at(3) ?? "inbox"
  if (tab === "tasks") return props.path.at(4) ? <TaskSkeleton /> : <TasksSkeleton />
  const section = spaceSections[tab] ?? spaceSections.inbox
  return (
    <Page title={section.title} description={section.description?.("this space")} width={section.width} loading>
      <SpaceSectionSample section={tab} />
    </Page>
  )
}

export function RouteSkeleton() {
  const path = Routing.useRenderedPath()
  if (path.startsWith("/sessions/")) return <ChatSkeleton />
  if (path.startsWith("/tasks/")) return <TaskSkeleton />
  if (path === "/drive") return <PageSkeleton title="Drive" width="full" />
  if (path.startsWith("/spaces/")) return <SpaceRouteSkeleton path={path.split("/")} />
  if (path === "/spaces")
    return (
      <PageSkeleton title="Spaces" description="Each space gives a team its own credentials, apps and agents.">
        <TableSample columns={["Space", "Description", "Members", ""]} />
      </PageSkeleton>
    )
  if (path === "/tasks") return <TasksSkeleton />
  if (path === "/automations")
    return (
      <PageSkeleton title="Automations" width="full">
        <TableSample columns={["Name", "Frequency", "Last run", "Next run", "Status", ""]} />
      </PageSkeleton>
    )
  if (path.startsWith("/apps/")) return <AppDetailSample />
  if (path === "/apps")
    return (
      <PageSkeleton
        title="Apps"
        width="wide"
        actions={<div className="h-8 w-56" />}
        description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      >
        <AppListingSample />
      </PageSkeleton>
    )
  if (path.startsWith("/settings")) return <SettingsPageSkeleton />
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 pt-4">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Logomark
          outline
          className="h-[min(40vh,--spacing(84))] w-auto shrink-0 -translate-y-1/4 mask-b-from-25% mask-b-to-72% text-foreground/10"
        />
      </div>
      <div className="relative flex w-full max-w-3xl flex-col gap-2">
        <Button variant="ghost" className="justify-start" disabled>
          Choose space
          <IconChevronDown />
        </Button>
        <ComposerFrame />
      </div>
    </div>
  )
}

function SettingsPageSkeleton() {
  const path = Routing.useRenderedPath()
  const section = path.split("/").at(2) ?? "preferences"
  const provider = Object.values(Channels.byId).find((provider) => provider.id === path.split("/").at(3))
  if (section === "channels" && provider)
    return (
      <Page
        title={provider.title}
        media={<ChannelMark provider={provider.id} className="size-8" />}
        back={
          <Button variant="ghost" size="sm">
            Back to channels
          </Button>
        }
        loading
      >
        <TableSample columns={["Channel", "Space", "Status", ""]} />
      </Page>
    )
  const titles: Readonly<Record<string, string>> = {
    preferences: "Preferences",
    general: "General",
    members: "Members",
    credentials: "Credentials",
    providers: "Providers",
    channels: "Channels",
    billing: "Billing & plans",
    permissions: "Permissions",
  }
  let body = <RowsSample />
  if (section === "members") body = <TableSample columns={["Name", "Email", "Role", ""]} />
  if (section === "general") body = <SettingsSample />
  if (section === "credentials") body = <TableSample columns={["App", "Used in", "Status", ""]} />
  if (section === "providers")
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Card key={index} className="gap-3 border px-4 ring-0">
            <span className="text-sm font-medium">Team subscription</span>
            <span className="text-xs text-muted-foreground">Connected</span>
            <p className="text-xs text-muted-foreground">Usage appears after the first request.</p>
          </Card>
        ))}
      </div>
    )
  if (section === "channels")
    body = (
      <div className="flex flex-col gap-8">
        {Channels.sections.map((section) => (
          <Section key={section.title} title={section.title}>
            <Rows>
              {section.providers.map((id) => (
                <Row
                  key={id}
                  title={Channels.byId[id].title}
                  media={<ChannelMark provider={id} className="size-6" />}
                  description="Connection status"
                />
              ))}
            </Rows>
          </Section>
        ))}
      </div>
    )
  if (section === "preferences")
    body = (
      <div className="flex flex-col gap-8">
        <Rows>
          {[
            <Row key="name" title="Name">
              <span className="text-sm">Team member</span>
            </Row>,
            <Row key="email" title="Email" description="Contact support to change.">
              <span className="text-sm">name@company.com</span>
            </Row>,
          ]}
        </Rows>
        <Section title="Appearance">
          <Rows>
            {[
              <Row key="theme" title="Theme">
                <Button variant="outline">Dark</Button>
              </Row>,
            ]}
          </Rows>
        </Section>
        <Section title="Typography">
          <Rows>
            {[
              <Row key="ui-font" title="Interface font">
                <Button variant="outline">SF Pro</Button>
              </Row>,
              <Row key="code-font" title="Code font">
                <Button variant="outline">IBM Plex Mono</Button>
              </Row>,
            ]}
          </Rows>
        </Section>
        <Section title="Timeline">
          <Rows>
            {[
              <Row key="detail" title="Timeline detail">
                <Button variant="outline">Compact</Button>
              </Row>,
              <Row key="width" title="Timeline width">
                <Button variant="outline">Comfortable</Button>
              </Row>,
              <Row
                key="background"
                title="Background activity"
                description="Running subagents and shells, above the composer."
              >
                <Button variant="outline">Left</Button>
              </Row>,
            ]}
          </Rows>
        </Section>
        <Section title="Chats">
          <Rows>
            {[
              <Row key="delivery" title="Messages sent while Ren works">
                <Button variant="outline">Steer</Button>
              </Row>,
            ]}
          </Rows>
        </Section>
        <Section title="Notifications">
          <Rows>
            {["Ren finishes", "Permissions", "Questions", "Errors", "Play a sound"].map((title) => (
              <Row key={title} title={title} description="When Ren is done.">
                <Switch aria-label={title} />
              </Row>
            ))}
          </Rows>
        </Section>
        <Section title="Security">
          <Rows>
            {[
              <Row key="password" title="Password">
                <Button variant="outline" size="sm">
                  Change password
                </Button>
              </Row>,
            ]}
          </Rows>
        </Section>
        <Section title="Organization">
          <Rows>
            {[
              <Row key="organization" title="Organization">
                <Button variant="outline" size="sm">
                  Leave organization
                </Button>
              </Row>,
            ]}
          </Rows>
        </Section>
      </div>
    )
  return (
    <Page
      title={titles[section] ?? "Settings"}
      description={
        {
          members: "Everyone in your organization.",
          providers: "Subscriptions your agents run on.",
          credentials: "App accounts and secrets you can use.",
          channels: "Invoke Ren from where your team already works.",
          permissions: "What agents in every space may do, and what they ask first.",
        }[section]
      }
      tabs={["members", "credentials", "permissions"].includes(section) ? <div className="min-h-8" /> : undefined}
      loading
    >
      {body}
    </Page>
  )
}
