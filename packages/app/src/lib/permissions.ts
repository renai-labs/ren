export * as Permissions from "./permissions.js"

import { Permission } from "@ren/schema/permission"
import { Schema } from "effect"

export type Decision = Permission.RuleEffect | "allow"

export type Rule = Permission.Rule

export interface Action {
  readonly action: string
  readonly label: string
  readonly description: string
  readonly common: boolean
  readonly denyOnly: boolean
  readonly pattern?: {
    readonly label: string
    readonly placeholder: string
    readonly noun: string
    readonly help: string
  }
}

export const actions: ReadonlyArray<Action> = [
  {
    action: "read",
    label: "Read files",
    description: "Open and inspect files.",
    common: true,
    denyOnly: false,
    pattern: {
      label: "File path",
      placeholder: "secrets/*",
      noun: "file",
      help: "A path inside the chat folder, or an absolute path outside it.",
    },
  },
  {
    action: "edit",
    label: "Edit files",
    description: "Create, change and patch files.",
    common: true,
    denyOnly: false,
    pattern: {
      label: "File path",
      placeholder: "*.env",
      noun: "file",
      help: "A path inside the chat folder, or an absolute path outside it.",
    },
  },
  {
    action: "shell",
    label: "Run commands",
    description: "Run commands in the terminal.",
    common: true,
    denyOnly: false,
    pattern: {
      label: "Command",
      placeholder: "git push *",
      noun: "command",
      help: "Checked against each command. “git push *” also matches “git push”.",
    },
  },
  {
    action: "webfetch",
    label: "Fetch web pages",
    description: "Read content from URLs.",
    common: true,
    denyOnly: false,
    pattern: { label: "URL", placeholder: "https://internal.example.com/*", noun: "URL", help: "The full URL." },
  },
  {
    action: "websearch",
    label: "Search the web",
    description: "Run internet searches.",
    common: true,
    denyOnly: false,
    pattern: { label: "Search query", placeholder: "*salaries*", noun: "search", help: "The search query." },
  },
  {
    action: "subagent",
    label: "Use subagents",
    description: "Hand work to other agents.",
    common: true,
    denyOnly: false,
    pattern: { label: "Agent name", placeholder: "general", noun: "agent", help: "The name of the subagent." },
  },
  {
    action: "skill",
    label: "Load skills",
    description: "Load specialized instructions.",
    common: true,
    denyOnly: false,
    pattern: { label: "Skill", placeholder: "deploy-*", noun: "skill", help: "The skill’s ID." },
  },
  {
    action: "external_directory",
    label: "Use folders outside the chat",
    description: "Read and change files outside the chat’s folder.",
    common: true,
    denyOnly: false,
    pattern: { label: "Folder", placeholder: "/etc/*", noun: "folder", help: "An absolute path ending in /*." },
  },
  {
    action: "question",
    label: "Ask questions",
    description: "Stop and ask someone in the chat.",
    common: true,
    denyOnly: true,
  },
  {
    action: "execute",
    label: "Run code",
    description: "Run code that calls apps and tools (Code Mode).",
    common: true,
    denyOnly: true,
  },
  {
    action: "glob",
    label: "Find files",
    description: "List files by name.",
    common: false,
    denyOnly: false,
    pattern: {
      label: "Search pattern",
      placeholder: "**/*.pem",
      noun: "pattern",
      help: "The pattern the agent searches for.",
    },
  },
  {
    action: "grep",
    label: "Search in files",
    description: "Search file contents.",
    common: false,
    denyOnly: false,
    pattern: {
      label: "Search pattern",
      placeholder: "password",
      noun: "pattern",
      help: "The pattern the agent searches for.",
    },
  },
  { action: "write", label: "Write files", description: "Write whole files.", common: false, denyOnly: true },
  { action: "patch", label: "Patch files", description: "Apply patches to files.", common: false, denyOnly: true },
]

const byAction = new Map(actions.map((each) => [each.action, each]))

export const find = (action: string) => byAction.get(action)

export const other = "other"

export interface Draft {
  readonly choice: string
  readonly tool: string
  readonly pattern: string
  readonly effect: Permission.RuleEffect
}

export const draftOf = (rule: Rule | undefined): Draft => {
  if (!rule) return { choice: "shell", tool: "", pattern: "", effect: "ask" }
  const known = byAction.has(rule.action)
  return {
    choice: known ? rule.action : other,
    tool: known ? "" : rule.action,
    pattern: rule.resource,
    effect: rule.effect,
  }
}

const anyPattern = { label: "Pattern", placeholder: "*", noun: "use", help: "What the tool works on." }

export const patternOf = (choice: string) => find(choice)?.pattern ?? anyPattern

export const isPatterned = (draft: Draft) => draft.choice === other || find(draft.choice)?.pattern !== undefined

export const isDenyOnly = (draft: Draft) => find(draft.choice)?.denyOnly ?? false

export const ruleOf = (draft: Draft): Rule => ({
  action: draft.choice === other ? draft.tool.trim() : draft.choice,
  resource: isPatterned(draft) ? draft.pattern.trim() : "*",
  effect: isDenyOnly(draft) ? "deny" : draft.effect,
})

export interface Problem {
  readonly field: "tool" | "pattern"
  readonly message: string
}

export const problemOf = (draft: Draft, siblings: ReadonlyArray<Rule>, scopeName: string): Problem | undefined => {
  const rule = ruleOf(draft)
  if (!rule.action) return { field: "tool", message: "Enter the tool’s name." }
  if (!rule.resource)
    return {
      field: "pattern",
      message: `Enter a pattern, or * for every ${patternOf(draft.choice).noun}.`,
    }
  if (!siblings.some((each) => same(each, rule))) return undefined
  return {
    field: isPatterned(draft) ? "pattern" : "tool",
    message: `${scopeName} already has a rule for ${rule.resource === "*" ? "this action" : rule.resource}.`,
  }
}

export const effectLabels: Record<Permission.RuleEffect, string> = { ask: "Ask first", deny: "Never" }

const rank: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 }

export const isStricter = (left: Decision, right: Decision) => rank[left] > rank[right]

export const strictest = (effects: ReadonlyArray<Decision>) =>
  effects.reduce<Decision>((worst, effect) => (isStricter(effect, worst) ? effect : worst), "allow")

const special = /[.+^${}()|[\]\\]/g

const matches = (input: string, pattern: string) => {
  const escaped = pattern.replaceAll(special, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")
  return new RegExp(`^${escaped.endsWith(" .*") ? `${escaped.slice(0, -3)}( .*)?` : escaped}$`, "s").test(input)
}

export const defaultOf = (rules: ReadonlyArray<Rule>, action: string) =>
  strictest(rules.filter((rule) => rule.resource === "*" && matches(action, rule.action)).map((rule) => rule.effect))

export const withDefault = (rules: ReadonlyArray<Rule>, action: string, effect: Decision): ReadonlyArray<Rule> => {
  const index = rules.findIndex((rule) => rule.action === action && rule.resource === "*")
  const rest = rules.filter((rule) => !(rule.action === action && rule.resource === "*"))
  if (effect === "allow") return rest
  const rule = { action, resource: "*", effect }
  return index === -1 ? [...rest, rule] : rest.toSpliced(index, 0, rule)
}

export const covering = (rules: ReadonlyArray<Rule>, rule: Rule) =>
  rules.find(
    (each) =>
      matches(rule.action, each.action) &&
      matches(rule.resource, each.resource) &&
      !isStricter(rule.effect, each.effect),
  )

const same = (left: Rule, right: Rule) => left.action === right.action && left.resource === right.resource

export const parse = Schema.decodeUnknownResult(Schema.fromJsonString(Permission.RuleList))

export const stringify = (rules: ReadonlyArray<Rule>) => JSON.stringify(rules, null, 2)
