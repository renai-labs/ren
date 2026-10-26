export * as Channels from "./channels.js"

import type { ChannelProvider } from "@ren/client"
import type { Glyph } from "@ren/ui/icon"

export type Provider = ChannelProvider

export type Category = "code" | "communication" | "planning"

export const sections: ReadonlyArray<{
  readonly category: Category
  readonly title: string
  readonly description: string
}> = [
  { category: "code", title: "Git providers", description: "Let Ren work in your repositories" },
  {
    category: "communication",
    title: "Communication",
    description: "Ren can join your team’s chats and work alongside everyone",
  },
  { category: "planning", title: "Task management", description: "Turn issues into pull requests" },
]

export interface Info {
  readonly id: Provider
  readonly title: string
  readonly glyph: Glyph
  readonly category: Category
  readonly description: string
  readonly place: { readonly noun: string; readonly title: string }
  readonly board: {
    readonly label: string
    readonly noun: string
    readonly glyph: Glyph
    readonly prefix: string
    readonly targetSharing: "exclusive" | "shared"
  }
}

export const byId: Readonly<Record<Provider, Info>> = {
  github: {
    id: "github",
    title: "GitHub",
    glyph: "Github",
    category: "code",
    description: "Clone repositories, create branches, commit changes, and review pull requests.",
    place: { noun: "repository", title: "Repository" },
    board: { label: "GitHub repositories", noun: "repo", glyph: "GitBranch", prefix: "", targetSharing: "shared" },
  },
  slack: {
    id: "slack",
    title: "Slack",
    glyph: "Slack",
    category: "communication",
    description: "Route channel mentions to spaces and respond in the conversation where work starts.",
    place: { noun: "channel", title: "Channel" },
    board: { label: "Slack channels", noun: "channel", glyph: "Hash", prefix: "#", targetSharing: "exclusive" },
  },
  linear: {
    id: "linear",
    title: "Linear",
    glyph: "Linear",
    category: "planning",
    description: "Assign work to Ren, respond to mentions, and keep issue conversations in sync.",
    place: { noun: "project", title: "Project" },
    board: { label: "Linear projects", noun: "Linear project", glyph: "ListChecks", prefix: "", targetSharing: "shared" },
  },
}

export const providers: ReadonlyArray<Info> = [byId.github, byId.slack, byId.linear]

export const describe = (error: unknown) => (error instanceof Error ? error.message : "Try again.")
