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

export const providers: ReadonlyArray<{
  readonly id: Provider
  readonly title: string
  readonly glyph: Glyph
  readonly category: Category
  readonly description: string
}> = [
  {
    id: "github",
    title: "GitHub",
    glyph: "Github",
    category: "code",
    description: "Clone repositories, create branches, commit changes, and review pull requests.",
  },
  {
    id: "slack",
    title: "Slack",
    glyph: "Slack",
    category: "communication",
    description: "Route channel mentions to spaces and respond in the conversation where work starts.",
  },
  {
    id: "linear",
    title: "Linear",
    glyph: "Linear",
    category: "planning",
    description: "Assign work to Ren, respond to mentions, and keep issue conversations in sync.",
  },
]

export const describe = (error: unknown) => (error instanceof Error ? error.message : "Try again.")
