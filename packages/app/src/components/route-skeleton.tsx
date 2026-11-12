import { AppListingSample } from "./app-list.js"
import { Loading } from "@ren/ui/loading"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Switch } from "@ren/ui/switch"
import { Channels } from "../lib/channels.js"
import { Routing } from "../lib/routing.js"
import { ChannelMark } from "./channel-mark.js"
import { Textarea } from "@ren/ui/textarea"
import { IconCircle, IconChevronDown } from "@tabler/icons-react"
import { ChatSkeleton, ComposerFrame } from "./chat-skeleton.js"
import { Logomark } from "../icons/logomark.js"
import { PersonAvatar } from "./person-avatar.js"
import { Page, PageSkeleton, Row, Rows, RowsSample, Section, TableSample, useShapeId } from "./page.js"

type SpaceSection = { title: string; description: (space: string) => string }

export const spaceSections: Readonly<Record<string, SpaceSection>> & { readonly overview: SpaceSection } = {
  overview: { title: "Overview", description: (space) => `The name and description of ${space}.` },
  settings: {
    title: "Settings",
    description: (space) => `The name, instructions and default model of ${space}.`,
  },
  compute: { title: "Compute", description: (space) => `Machines for ${space}’s brain and tools.` },
  members: { title: "Members", description: (space) => `People who can use ${space}.` },
  apps: { title: "Apps", description: (space) => `Apps every chat in ${space} can use.` },
  repositories: {
    title: "Repositories",
    description: (space) => `Repositories Ren can read in ${space}. To change code, ask Ren to clone one.`,
  },
  channels: {
    title: "Channels",
    description: (space) => `Channels where people can mention @Ren to work in ${space}.`,
  },
  credentials: { title: "Keys", description: (space) => `Keys every chat in ${space} can use.` },
  schedules: { title: "Scheduled", description: (space) => `Work that starts in ${space} on a schedule.` },
  webhooks: {
    title: "Webhooks",
    description: (space) => `URLs that start sessions in ${space} when another app sends a request.`,
  },
  factory: { title: "Factory", description: (space) => `Agents that work on tasks in ${space}.` },
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
  const table = (columns: ReadonlyArray<string>) => (
    <div className="flex flex-col gap-4">
      <div className="min-h-8" />
      <TableSample columns={columns} count={3} />
    </div>
  )
  if (props.section === "members") return table(["Name", "Email", "Status", ""])
  if (props.section === "credentials") return table(["Key", "Hosts", "Owner", ""])
  if (props.section === "repositories") return table(["Repository", "Description", ""])
  if (props.section === "apps") return table(["App", "Used in", "Status", ""])
  if (props.section === "schedules") return table(["Name", "Frequency", "Next run", "Status", ""])
  if (props.section === "channels") return table(["Channel", "Provider", ""])
  if (props.section === "factory") return <RowsSample count={3} />
  if (props.section === "kanban")
    return (
      <div className="flex gap-4 overflow-hidden">
        {["Backlog", "Plan", "Build", "Review"].map((title) => (
          <section key={title} className="flex w-72 shrink-0 flex-col gap-3">
            <h2 className="text-sm font-medium">{title}</h2>
            {Array.from({ length: 3 }, (_, index) => (
              <Card key={index} className="gap-3 p-4">
                <span className="text-sm">Task title</span>
                <span className="text-xs text-muted-foreground">Task details</span>
              </Card>
            ))}
          </section>
        ))}
      </div>
    )
  return <RowsSample count={2} />
}

export function SpaceSectionSkeleton() {
  const path = Routing.useRenderedPath()
  const shapeId = useShapeId("page")
  return (
    <Loading id={shapeId} label="Loading space">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-8">
          <SpaceSectionSample section={path.split("/").at(3) ?? "overview"} />
        </div>
      </div>
    </Loading>
  )
}

export function RouteSkeleton() {
  const path = Routing.useRenderedPath()
  if (path.startsWith("/sessions/")) return <ChatSkeleton />
  if (path.startsWith("/tasks/"))
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
  if (path.startsWith("/spaces/")) {
    const tab = path.split("/").at(3) ?? "overview"
    const section = spaceSections[tab] ?? spaceSections.overview
    return (
      <Page title={section.title} description={section.description("this space")} loading>
        <SpaceSectionSample section={tab} />
      </Page>
    )
  }
  if (path === "/spaces")
    return (
      <PageSkeleton
        title="Spaces"
        description="Each space gives a team its own credentials, apps and agents."
        body="cards"
      />
    )
  if (path === "/tasks")
    return (
      <PageSkeleton title="Tasks" width="full" shape="tasks-first-load">
        <TasksSample />
      </PageSkeleton>
    )
  if (path === "/schedules")
    return (
      <PageSkeleton title="Scheduled" description="Work that starts on a schedule instead of a message.">
        <TableSample columns={["Name", "Frequency", "Next run", "Status", ""]} />
      </PageSkeleton>
    )
  if (path.startsWith("/apps/")) return <PageSkeleton title="Loading app" />
  if (path === "/apps")
    return (
      <PageSkeleton
        title="Apps"
        width="wide"
        search={<div className="h-8 w-56" />}
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
            <Row key="email" title="Email" description="Contact support to change.">
              <span className="text-sm">name@company.com</span>
            </Row>,
            <Row key="name" title="Name">
              <span className="text-sm">Team member</span>
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
        <Section title="Chats">
          <Rows>
            {[
              <Row key="detail" title="Detail" description="How much of Ren’s work a chat shows.">
                <Button variant="outline">Compact</Button>
              </Row>,
              <Row key="delivery" title="Messages sent while Ren works">
                <Button variant="outline">Steer</Button>
              </Row>,
              <Row
                key="notify"
                title="Notify me when Ren finishes or needs input"
                description="Only while Ren’s tab is in the background."
              >
                <Switch aria-label="Notify me" />
              </Row>,
            ]}
          </Rows>
        </Section>
        <Section title="Organization">
          <Rows>
            {[
              <Row
                key="organization"
                title="Organization"
                description="Leaving archives your private space and deletes your personal credentials here."
              >
                <Button variant="outline" size="sm">
                  Leave organization
                </Button>
              </Row>,
            ]}
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
      </div>
    )
  return (
    <Page
      title={titles[section] ?? "Settings"}
      description={
        {
          members: "Everyone in your organization.",
          providers: "Subscriptions your agents run on.",
          credentials: "App accounts and keys you can use.",
          channels: "Invoke Ren from where your team already works.",
        }[section]
      }
      actions={["members", "credentials", "providers"].includes(section) ? <div className="min-h-8" /> : undefined}
      loading
    >
      {body}
    </Page>
  )
}
