export * as OnboardingSteps from "./onboarding-steps.js"

import type { ChannelProvider, OnboardingInfo, OnboardingReward, OnboardingStep } from "@ren/client"
import { Onboarding } from "@ren/schema/onboarding"

export type Action =
  | { readonly kind: "star" }
  | { readonly kind: "import-memory" }
  | { readonly kind: "channel"; readonly provider: ChannelProvider }
  | { readonly kind: "invite" }
  | { readonly kind: "chat"; readonly prompt: string }
  | { readonly kind: "automation" }
  | { readonly kind: "custom-app" }
  | { readonly kind: "infra" }

interface Part {
  readonly step: OnboardingStep
  readonly title: string
  readonly slug: keyof typeof Onboarding.appSteps
}

interface Task {
  readonly step: OnboardingStep
  readonly title: string
  readonly description: string
  readonly action?: Action
  readonly parts?: ReadonlyArray<Part>
  readonly needed?: number
}

export interface PartState {
  readonly part: Part
  readonly done: boolean
  readonly reward: OnboardingReward | null
}

export interface State {
  readonly task: Task
  readonly done: boolean
  readonly reward: OnboardingReward | null
  readonly parts: ReadonlyArray<PartState>
}

const steps = Onboarding.steps

const personal: ReadonlyArray<Task> = [
  {
    step: steps.personal.githubStarred,
    title: "Star Ren on GitHub",
    description: "Star renai-labs/ren to follow each release.",
    action: { kind: "star" },
  },
  {
    step: steps.personal.appsConnected,
    title: `Connect ${Onboarding.appsNeeded} apps`,
    description: "Ren uses an app’s tools in every space you add its account to.",
    needed: Onboarding.appsNeeded,
    parts: [
      { step: Onboarding.appSteps.gmail, title: "Gmail", slug: "gmail" },
      { step: Onboarding.appSteps.granola, title: "Granola", slug: "granola" },
      { step: Onboarding.appSteps.github, title: "GitHub", slug: "github" },
      { step: Onboarding.appSteps["google-drive"], title: "Google Drive", slug: "google-drive" },
    ],
  },
  {
    step: steps.personal.memoryImported,
    title: "Import memory from another agent",
    description: "Bring what ChatGPT or Claude knows about you into Ren.",
    action: { kind: "import-memory" },
  },
]

const organization: ReadonlyArray<Task> = [
  {
    step: steps.organization.slackConnected,
    title: "Connect Slack",
    description: "Mention @Ren in a Slack channel, and it replies in the thread.",
    action: { kind: "channel", provider: "slack" },
  },
  {
    step: steps.organization.githubConnected,
    title: "Connect GitHub",
    description: "Mention @Ren on a GitHub issue or pull request, and it replies there.",
    action: { kind: "channel", provider: "github" },
  },
  {
    step: steps.organization.memberJoined,
    title: "Invite members",
    description: "Work with your team in the spaces you share.",
    action: { kind: "invite" },
  },
  {
    step: steps.organization.artifactCreated,
    title: "Build an artifact",
    description: "Ren builds a dashboard or report and publishes it at its own link.",
    action: { kind: "chat", prompt: "Make an artifact of " },
  },
  {
    step: steps.organization.scheduleCreated,
    title: "Run an agent on a schedule",
    description: "An automation starts an agent in a space at the times you pick.",
    action: { kind: "automation" },
  },
  {
    step: steps.organization.webhookCreated,
    title: "Run an agent from a webhook",
    description: "An automation starts an agent each time another app sends a request.",
    action: { kind: "automation" },
  },
  {
    step: steps.organization.factoryCreated,
    title: "Set up a factory",
    description: "Chain the agents of a space, so a task moves from one agent to the next without you.",
    action: {
      kind: "chat",
      prompt:
        "Set up a factory in this space: a triager reads each new bug and hands it to a fixer, and a reviewer checks the fixer’s pull request.",
    },
  },
  {
    step: steps.organization.customAppCreated,
    title: "Make an app from your MCP servers",
    description: "Give your spaces the tools of your own MCP servers and skills.",
    action: { kind: "custom-app" },
  },
  {
    step: steps.organization.iacApplied,
    title: "Manage Ren as code",
    description: "Keep your spaces, agents and settings in a .ren folder, and apply changes from the CLI.",
    action: { kind: "infra" },
  },
]

export const appSlugs = Object.keys(Onboarding.appSteps)

export function states(info: OnboardingInfo, options: { readonly admin: boolean }): ReadonlyArray<State> {
  const byStep = new Map(
    [...info.personal.steps, ...(options.admin ? info.organization.steps : [])].map((state) => [state.step, state]),
  )
  return [...personal, ...(options.admin ? organization : [])].flatMap((task) => {
    const state = byStep.get(task.step)
    if (!state) return []
    return [
      {
        task,
        done: state.completedAt !== null,
        reward: state.reward,
        parts: (task.parts ?? []).map((part) => ({
          part,
          done: Boolean(byStep.get(part.step)?.completedAt),
          reward: byStep.get(part.step)?.reward ?? null,
        })),
      },
    ]
  })
}

export function progress(list: ReadonlyArray<State>) {
  const rewards = list.flatMap((state) => [state.reward, ...state.parts.map((part) => part.reward)])
  return {
    done: list.filter((state) => state.done).length,
    total: list.length,
    earnedMicroUsd: rewards.reduce((sum, reward) => sum + (reward?.earnedMicroUsd ?? 0), 0),
    availableMicroUsd: rewards.reduce((sum, reward) => sum + (reward ? reward.microUsd * (reward.upTo ?? 1) : 0), 0),
  }
}
