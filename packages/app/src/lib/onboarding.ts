export * as Onboarding from "./onboarding.js"

import type { ChannelProvider, OnboardingChecklist, OnboardingInfo, OnboardingReportInput } from "@ren/client"
import { githubUrl } from "./links.js"

export type Guide = "infra"

export type Action =
  | {
      readonly kind: "external"
      readonly label: string
      readonly href: string
      readonly report?: OnboardingReportInput["step"]
    }
  | { readonly kind: "app"; readonly label: string; readonly slug: string }
  | { readonly kind: "channel"; readonly label: string; readonly provider: ChannelProvider }
  | { readonly kind: "provider"; readonly label: string }
  | { readonly kind: "custom-app"; readonly label: string }
  | { readonly kind: "import-memory"; readonly label: string }
  | { readonly kind: "invite"; readonly label: string }
  | { readonly kind: "page"; readonly label: string; readonly to: "/automations/new" }
  | { readonly kind: "guide"; readonly label: string; readonly guide: Guide }
  | { readonly kind: "chat"; readonly label: string; readonly prompt: string }

export interface Reward {
  readonly usd: number
  readonly upTo?: number
}

export interface Part {
  readonly step: string
  readonly title: string
  readonly mark:
    | { readonly logo: string; readonly mono?: true }
    | { readonly brand: "github" | "slack" }
    | { readonly glyph: "import" | "plugin" }
  readonly action: Action
}

export interface Task {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly reward?: Reward
  readonly action?: Action
  readonly parts?: ReadonlyArray<Part>
  readonly needed?: number
  readonly given?: true
}

export interface PartState {
  readonly part: Part
  readonly done: boolean
}

export interface TaskState {
  readonly task: Task
  readonly done: boolean
  readonly parts: ReadonlyArray<PartState>
  readonly partsDone: number
  readonly partsNeeded: number
  readonly earned: number
  readonly available: number
}

export interface Progress {
  readonly done: number
  readonly total: number
  readonly earned: number
  readonly available: number
}

export const personal: ReadonlyArray<Task> = [
  {
    id: "github.starred",
    title: "Star Ren on GitHub",
    description: "Star renai-labs/ren to follow each release.",
    reward: { usd: 2 },
    action: { kind: "external", label: "Star on GitHub", href: githubUrl, report: "github.starred" },
  },
  {
    id: "apps.connected",
    title: "Connect 3 apps",
    description: "Ren uses an app’s tools in every space you add its account to.",
    reward: { usd: 3 },
    needed: 3,
    parts: [
      {
        step: "gmail.connected",
        title: "Gmail",
        mark: { logo: "gmail" },
        action: { kind: "app", label: "Connect", slug: "gmail" },
      },
      {
        step: "granola.connected",
        title: "Granola",
        mark: { logo: "granola", mono: true },
        action: { kind: "app", label: "Connect", slug: "granola" },
      },
      {
        step: "github.app.connected",
        title: "GitHub",
        mark: { brand: "github" },
        action: { kind: "app", label: "Connect", slug: "github" },
      },
      {
        step: "drive.connected",
        title: "Google Drive",
        mark: { logo: "google-drive" },
        action: { kind: "app", label: "Connect", slug: "google-drive" },
      },
    ],
  },
  {
    id: "setup.imported",
    title: "Bring your setup from another agent",
    description: "Move what your last agent knew, and the tools it used, into Ren.",
    parts: [
      {
        step: "memory.imported",
        title: "Import memory from another agent",
        mark: { glyph: "import" },
        action: { kind: "import-memory", label: "Import" },
      },
      {
        step: "custom-app.created",
        title: "Make an app from your MCP servers and skills",
        mark: { glyph: "plugin" },
        action: { kind: "custom-app", label: "Create app" },
      },
    ],
  },
]

export const organization: ReadonlyArray<Task> = [
  {
    id: "organization.created",
    title: "Create your organization",
    description: "It holds your members, your spaces and the settings every space shares.",
    reward: { usd: 5 },
    given: true,
  },
  {
    id: "channel.connected",
    title: "Connect Slack or GitHub",
    description: "Mention @Ren in a Slack channel or on a GitHub issue, and it replies in the thread.",
    reward: { usd: 5 },
    needed: 1,
    parts: [
      {
        step: "slack.connected",
        title: "Slack",
        mark: { brand: "slack" },
        action: { kind: "channel", label: "Connect", provider: "slack" },
      },
      {
        step: "github.connected",
        title: "GitHub",
        mark: { brand: "github" },
        action: { kind: "channel", label: "Connect", provider: "github" },
      },
    ],
  },
  {
    id: "provider.connected",
    title: "Connect Claude or ChatGPT",
    description: "Agents then run on your subscription instead of Ren credits.",
    action: { kind: "provider", label: "Connect" },
  },
  {
    id: "member.joined",
    title: "Invite members",
    description: "Earn $1 for each member who joins, for up to 5 members.",
    reward: { usd: 1, upTo: 5 },
    action: { kind: "invite", label: "Invite members" },
  },
  {
    id: "artifact.created",
    title: "Build an artifact",
    description: "Ren builds a dashboard or report and publishes it at its own link.",
    reward: { usd: 1 },
    action: { kind: "chat", label: "Build", prompt: "Make an artifact of " },
  },
  {
    id: "automation.created",
    title: "Create an automation",
    description: "An agent runs in a space on a schedule, or each time another app sends a request.",
    reward: { usd: 2 },
    action: { kind: "page", label: "Create", to: "/automations/new" },
  },
  {
    id: "factory.created",
    title: "Set up a factory",
    description: "Chain the agents of a space, so a task moves from one agent to the next without you.",
    reward: { usd: 1 },
    action: {
      kind: "chat",
      label: "Set up",
      prompt:
        "Set up a factory in this space: a triager reads each new bug and hands it to a fixer, and a reviewer checks the fixer’s pull request.",
    },
  },
  {
    id: "iac.applied",
    title: "Manage Ren as code",
    description: "Keep your spaces, agents and settings in a .ren folder, and apply changes from the CLI.",
    action: { kind: "guide", label: "View steps", guide: "infra" },
  },
]

export const appSlugs = personal.flatMap((task) =>
  (task.parts ?? []).flatMap((part) => (part.action.kind === "app" ? [part.action.slug] : [])),
)

export const empty: OnboardingInfo = {
  organization: { steps: [], dismissedAt: null },
  personal: { steps: [], dismissedAt: null },
}

export const usd = (value: number) => `$${value}`

export function rewardLabel(state: TaskState) {
  if (state.done) return `Earned ${usd(state.earned)}`
  return state.task.reward?.upTo ? `Earn up to ${usd(state.available)}` : `Earn ${usd(state.available)}`
}

export function states(tasks: ReadonlyArray<Task>, checklist: OnboardingChecklist): ReadonlyArray<TaskState> {
  const completed = new Set<string>(checklist.steps.flatMap((state) => (state.completedAt ? [state.step] : [])))
  return tasks.map((task) => {
    const parts = (task.parts ?? []).map((part) => ({ part, done: completed.has(part.step) }))
    const partsDone = parts.filter((part) => part.done).length
    const partsNeeded = task.needed ?? parts.length
    const done = task.given === true || (parts.length > 0 ? partsDone >= partsNeeded : completed.has(task.id))
    const available = task.reward ? (task.reward.upTo ?? task.reward.usd) : 0
    return { task, done, parts, partsDone, partsNeeded, earned: done ? (task.reward?.usd ?? 0) : 0, available }
  })
}

function progress(tasks: ReadonlyArray<TaskState>): Progress {
  return {
    done: tasks.filter((task) => task.done).length,
    total: tasks.length,
    earned: tasks.reduce((sum, task) => sum + task.earned, 0),
    available: tasks.reduce((sum, task) => sum + task.available, 0),
  }
}

export function checklists(info: OnboardingInfo, options: { readonly admin: boolean }) {
  const mine = states(personal, info.personal)
  const shared = options.admin ? states(organization, info.organization) : []
  return { personal: mine, organization: options.admin ? shared : null, progress: progress([...mine, ...shared]) }
}
