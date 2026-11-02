import { AppListingSkeleton } from "./app-list.js"
import { useLocation } from "@tanstack/react-router"
import { Loading } from "@ren/ui/loading"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Switch } from "@ren/ui/switch"
import { Channels } from "../lib/channels.js"
import { ChannelMark } from "./channel-mark.js"
import { Textarea } from "@ren/ui/textarea"
import { IconCircle, IconChevronDown } from "@tabler/icons-react"
import { ChatSkeleton, ComposerFrame } from "./chat-skeleton.js"
import { Logomark } from "./logomark.js"
import { Page, PageSkeleton, Row, Rows, Section, SkeletonRows, SkeletonTable } from "./page.js"

type SpaceSection = { title: string; description: (space: string) => string }

export const spaceSections: Readonly<Record<string, SpaceSection>> & { readonly overview: SpaceSection } = {
  overview: { title: "Overview", description: (space) => `The name and description of ${space}.` },
  members: { title: "Members", description: (space) => `People who can use ${space}.` },
  apps: { title: "Apps", description: (space) => `Apps every chat in ${space} can use.` },
  repositories: {
    title: "Repositories",
    description: (space) => `Repositories Ren can read in ${space}. To change code, ask Ren to clone one.`,
  },
  channels: {
    title: "Mentions",
    description: (space) => `Channels where people can mention @Ren to work in ${space}.`,
  },
  credentials: { title: "Keys", description: (space) => `Keys every chat in ${space} can use.` },
  schedules: { title: "Scheduled", description: (space) => `Work that starts in ${space} on a schedule.` },
  factory: { title: "Factory", description: (space) => `Agents that work on tasks in ${space}.` },
}

export function TasksSkeleton() {
  return (
    <Loading label="Loading tasks">
      <div className="flex flex-col gap-4">
        {["Backlog", "In progress"].map((title) => (
          <div key={title}>
            <div className="flex h-9 items-center gap-2 rounded-lg bg-muted px-2 text-sm">
              <IconChevronDown className="size-3.5" />
              <span>{title}</span>
            </div>
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex min-h-9 items-center gap-3 border-b px-3 text-sm">
                <IconCircle className="size-4" />
                <span className="text-muted-foreground">REN-{index + 1}</span>
                <span>Task title</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Loading>
  )
}

function SettingsSkeleton() {
  return (
    <>
      <SkeletonRows count={2} label="Loading settings" />
      <Section title="Instructions">
        <Loading label="Loading instructions">
          <Textarea
            readOnly
            aria-label="Instructions"
            placeholder="Instructions for your agents"
            className="min-h-110 rounded-xl bg-card p-4 dark:bg-card"
          />
        </Loading>
      </Section>
    </>
  )
}

export function SpaceSectionSkeleton() {
  const section = useLocation({ select: (location) => location.pathname.split("/").at(3) ?? "overview" })
  if (section === "members")
    return <SkeletonTable columns={["Name", "Email", "Status", ""]} label="Loading members" toolbar />
  if (section === "credentials")
    return <SkeletonTable columns={["Key", "Hosts", "Owner", ""]} label="Loading keys" toolbar />
  if (section === "repositories")
    return <SkeletonTable columns={["Repository", "Description", ""]} label="Loading repositories" toolbar />
  if (section === "apps")
    return <SkeletonTable columns={["App", "Used in", "Status", ""]} label="Loading apps" toolbar />
  if (section === "schedules")
    return <SkeletonTable columns={["Name", "Frequency", "Next run", "Status", ""]} label="Loading schedules" toolbar />
  if (section === "channels")
    return <SkeletonTable columns={["Channel", "Provider", ""]} label="Loading mentions" toolbar />
  if (section === "factory") return <SkeletonRows count={3} label="Loading agents" />
  if (section === "kanban")
    return (
      <Loading label="Loading board">
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
      </Loading>
    )
  return <SkeletonRows count={2} label="Loading space" />
}

export function RouteSkeleton() {
  const path = useLocation({ select: (location) => location.pathname })
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
      <Page title={section.title} description={section.description("this space")}>
        <SpaceSectionSkeleton />
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
      <PageSkeleton title="Tasks" width="full">
        <TasksSkeleton />
      </PageSkeleton>
    )
  if (path === "/schedules")
    return (
      <PageSkeleton title="Scheduled" description="Work that starts on a schedule instead of a message.">
        <SkeletonTable columns={["Name", "Frequency", "Next run", "Status", ""]} label="Loading schedules" />
      </PageSkeleton>
    )
  if (path === "/marketplace")
    return (
      <PageSkeleton
        title="Marketplace"
        description="Apps give Ren new tools. Add one to a space and every chat there can use it."
      >
        <AppListingSkeleton />
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

export function SettingsPageSkeleton() {
  const path = useLocation({ select: (location) => location.pathname })
  const section = path.split("/").at(2) ?? "preferences"
  const provider = Object.values(Channels.byId).find((provider) => provider.id === path.split("/").at(3))
  if (section === "channels" && provider)
    return (
      <Page
        title={provider.title}
        media={<ChannelMark provider={provider.id} className="size-8" />}
        back={
          <Button variant="ghost" size="sm">
            Back to @mentions
          </Button>
        }
      >
        <SkeletonTable columns={["Channel", "Space", "Status", ""]} label="Loading mappings" />
      </Page>
    )
  const titles: Readonly<Record<string, string>> = {
    preferences: "Preferences",
    general: "General",
    members: "Members",
    credentials: "Credentials",
    providers: "Providers",
    channels: "@mentions",
  }
  let body = <SkeletonRows label={`Loading ${section}`} />
  if (section === "members") body = <SkeletonTable columns={["Name", "Email", "Role", ""]} label="Loading members" />
  if (section === "general") body = <SettingsSkeleton />
  if (section === "credentials")
    body = <SkeletonTable columns={["App", "Used in", "Status", ""]} label="Loading credentials" />
  if (section === "providers")
    body = (
      <Loading label="Loading subscriptions">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <Card key={index} className="gap-3 border px-4 ring-0">
              <span className="text-sm font-medium">Team subscription</span>
              <span className="text-xs text-muted-foreground">Connected</span>
              <p className="text-xs text-muted-foreground">Usage appears after the first request.</p>
            </Card>
          ))}
        </div>
      </Loading>
    )
  if (section === "channels")
    body = (
      <Loading label="Loading mentions">
        <div className="flex flex-col gap-8">
          {Channels.sections.map((section) => (
            <Section key={section.title} title={section.title} description={section.description}>
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
      </Loading>
    )
  if (section === "preferences")
    body = (
      <Loading label="Loading preferences">
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
      </Loading>
    )
  return (
    <Page
      title={titles[section] ?? "Settings"}
      description={
        {
          providers: "Subscriptions your agents run on.",
          credentials: "App accounts and keys you can use.",
          channels: "Invoke Ren from where your team already works.",
        }[section]
      }
    >
      {body}
    </Page>
  )
}
