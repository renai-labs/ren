export * as BrainSettings from "./settings.js"

import { Drive } from "@ren/schema/drive"
import { Permission } from "@ren/schema/permission"
import { Reference } from "@ren/schema/reference"
import { Session } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import { Settings } from "@ren/schema/settings"
import { Array, Option, Result, Schema } from "effect"

export class Unconfigured extends Schema.TaggedError<Unconfigured>()("BrainSettings.Unconfigured", {
  message: Schema.String,
}) {}

export interface Agent extends Schema.Schema.Type<typeof Agent> {}
export const Agent = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  instructions: Schema.Array(Schema.String),
  permissions: Permission.RuleList,
  model: Session.Model,
  steps: Schema.Int,
}).annotate({ identifier: "BrainSettings.Agent" })

export interface Resolved extends Schema.Schema.Type<typeof Resolved> {}
export const Resolved = Schema.Struct({
  primary: Agent,
  subagents: Schema.Array(Agent),
  references: Reference.List,
  drives: Schema.optionalKey(Drive.Availability),
}).annotate({ identifier: "BrainSettings.Resolved" })

export interface Chat extends Schema.Schema.Type<typeof ChatSettings> {}
export const ChatSettings = Schema.Struct({ resolved: Resolved, interactive: Schema.Boolean }).annotate({
  identifier: "BrainSettings.ChatSettings",
})

export interface Request {
  readonly action: string
  readonly resources: ReadonlyArray<string>
}

export interface Decision {
  readonly effect: "allow" | "ask" | "deny"
  readonly message?: string
}

export type Layers = SessionSettings.Layers

export interface Placement {
  readonly agent: string | null
  readonly model: Option.Option<Session.Model>
  readonly drives?: Drive.Availability | undefined
}

export type Lookup = (model: Session.Model) => Option.Option<{ readonly variants: ReadonlyArray<string> }>

export const empty: Layers = { ren: { hash: null }, organization: { hash: null }, space: { hash: null }, agents: [] }

const matches = (input: string, pattern: string) => {
  const escaped = pattern
    .replaceAll("\\", "/")
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".")
  return new RegExp(`^${escaped.endsWith(" .*") ? `${escaped.slice(0, -3)}( .*)?` : escaped}$`, "s").test(
    input.replaceAll("\\", "/"),
  )
}

const union = (rules: ReadonlyArray<Permission.Rule>) =>
  Array.dedupeWith(
    rules,
    (left, right) => left.action === right.action && left.resource === right.resource && left.effect === right.effect,
  )

const available = (lookup: Lookup, model: Session.Model | undefined): Option.Option<Session.Model> => {
  if (!model) return Option.none()
  return Option.map(lookup(model), (found) => {
    if (!model.variant || found.variants.includes(model.variant)) return model
    const first = found.variants.at(0)
    return { endpointId: model.endpointId, modelId: model.modelId, ...(first && { variant: first }) }
  })
}

export const resolve = (layers: Layers, chat: Placement, lookup: Lookup): Result.Result<Resolved, Unconfigured> => {
  const primary =
    layers.agents.find((agent) => !agent.isSubagent && agent.name === chat.agent) ??
    layers.agents.find((agent) => !agent.isSubagent)
  if (!primary) return Result.fail(new Unconfigured({ message: "Ren is not configured: the chat has no agent." }))
  const shared = [layers.ren, layers.organization, layers.space].flatMap((layer) =>
    layer.settings ? [layer.settings] : [],
  )
  const own = [...shared, primary.settings]
  const candidates = [Option.getOrUndefined(chat.model), ...own.toReversed().map((settings) => settings.model)]
  const model = candidates.reduce<Option.Option<Session.Model>>(
    (found, candidate) => (Option.isSome(found) ? found : available(lookup, candidate)),
    Option.none(),
  )
  if (Option.isNone(model)) return Result.fail(new Unconfigured({ message: "No available model is set." }))
  const instructions = (all: ReadonlyArray<Settings.Info>) =>
    all.flatMap((settings) => (settings.instructions?.trim() ? [settings.instructions] : []))
  const permissions = union(own.flatMap((settings) => settings.permissions))
  const steps = (all: ReadonlyArray<Settings.Info>) =>
    all.findLast((settings) => Boolean(settings.steps))?.steps ?? Settings.defaultSteps
  return Result.succeed({
    primary: {
      name: primary.name,
      description: primary.description,
      instructions: instructions(own),
      permissions,
      model: model.value,
      steps: steps(own),
    },
    subagents: layers.agents
      .filter((agent) => agent.isSubagent)
      .map((agent) => ({
        name: agent.name,
        description: agent.description,
        instructions: instructions([...shared, agent.settings]),
        permissions: union([...permissions, ...agent.settings.permissions]),
        model: Option.getOrElse(available(lookup, agent.settings.model), () => model.value),
        steps: steps([...shared, agent.settings]),
      })),
    references: Array.fromIterable(
      new Map(
        own.flatMap((settings) => settings.references.map((reference) => [reference.alias, reference] as const)),
      ).values(),
    ).toSorted((left, right) => left.alias.localeCompare(right.alias)),
    ...(chat.drives && { drives: chat.drives }),
  })
}

const rank = { allow: 0, ask: 1, deny: 2 } as const

export const evaluate = (
  agent: Agent,
  request: Request,
  options: { readonly interactive: boolean; readonly denied: Permission.RuleList },
): Decision => {
  const effect = [...agent.permissions, ...options.denied]
    .filter(
      (rule) =>
        matches(request.action, rule.action) && request.resources.some((resource) => matches(resource, rule.resource)),
    )
    .reduce<Decision["effect"]>((worst, rule) => (rank[rule.effect] > rank[worst] ? rule.effect : worst), "allow")
  if (effect === "ask" && !options.interactive)
    return {
      effect: "deny",
      message: `${request.action} needs approval, and no one can approve it in this session.`,
    }
  return { effect }
}
