export * as BrainSettings from "./settings.js"

import type { Permission } from "@ren/schema/permission"
import type { Reference } from "@ren/schema/reference"
import { Session } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import type { Settings } from "@ren/schema/settings"
import { Array, Effect, Option, Ref, Schema, Semaphore } from "effect"

export class PullError extends Schema.TaggedError<PullError>()("BrainSettings.PullError", {
  message: Schema.String,
}) {}

export class Unconfigured extends Schema.TaggedError<Unconfigured>()("BrainSettings.Unconfigured", {
  message: Schema.String,
}) {}

export class UnknownModel extends Schema.TaggedError<UnknownModel>()("BrainSettings.UnknownModel", {
  model: Session.Model,
  message: Schema.String,
}) {}

export interface Agent {
  readonly name: string
  readonly description: string | null
  readonly instructions: ReadonlyArray<string>
  readonly permissions: Permission.RuleList
  readonly model: Session.Model
}

export interface Resolved {
  readonly primary: Agent
  readonly subagents: ReadonlyArray<Agent>
  readonly references: Reference.List
}

export interface Request {
  readonly action: string
  readonly resources: ReadonlyArray<string>
}

export interface Decision {
  readonly effect: "allow" | "ask" | "deny"
  readonly message?: string
}

export interface Host {
  readonly read: (known: SessionSettings.Known) => Effect.Effect<SessionSettings.Layers, PullError>
  readonly available: (model: Session.Model) => Effect.Effect<boolean>
}

export type Failure = PullError | Unconfigured | UnknownModel

export interface Interface {
  readonly pull: Effect.Effect<Resolved, Failure>
  readonly setModel: (model: Option.Option<Session.Model>) => Effect.Effect<Resolved, Failure>
}

interface Layers {
  readonly ren: SessionSettings.Layer
  readonly organization: SessionSettings.Layer
  readonly space: SessionSettings.Layer
  readonly agents: ReadonlyArray<SessionSettings.AgentLayer & { readonly settings: Settings.Info }>
}

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

const resolve = (layers: Layers, override: Option.Option<Session.Model>): Effect.Effect<Resolved, Unconfigured> =>
  Effect.gen(function* () {
    const primary = layers.agents.find((agent) => !agent.isSubagent)
    if (!primary) return yield* new Unconfigured({ message: "Ren is not configured: the session has no agent." })
    const shared = [layers.ren, layers.organization, layers.space].flatMap((layer) =>
      layer.settings ? [layer.settings] : [],
    )
    const own = [...shared, primary.settings]
    const model = Option.getOrUndefined(override) ?? own.findLast((settings) => settings.model)?.model
    if (!model) return yield* new Unconfigured({ message: "Ren is not configured: no layer sets a model." })
    const instructions = (all: ReadonlyArray<Settings.Info>) =>
      all.flatMap((settings) => (settings.instructions?.trim() ? [settings.instructions] : []))
    const permissions = union(own.flatMap((settings) => settings.permissions))
    return {
      primary: {
        name: primary.name,
        description: primary.description,
        instructions: instructions(own),
        permissions,
        model,
      },
      subagents: layers.agents
        .filter((agent) => agent.isSubagent)
        .map((agent) => ({
          name: agent.name,
          description: agent.description,
          instructions: instructions([...shared, agent.settings]),
          permissions: union([...permissions, ...agent.settings.permissions]),
          model: agent.settings.model ?? model,
        })),
      references: Array.fromIterable(
        new Map(
          own.flatMap((settings) => settings.references.map((reference) => [reference.alias, reference] as const)),
        ).values(),
      ).toSorted((left, right) => left.alias.localeCompare(right.alias)),
    }
  })

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

export const hiddenTools = (agent: Agent, denied: Permission.RuleList, tools: ReadonlyArray<string>) =>
  tools.filter((tool) =>
    [...agent.permissions, ...denied].some(
      (rule) => rule.effect === "deny" && rule.resource === "*" && matches(tool, rule.action),
    ),
  )

const checkModel = (host: Host, model: Session.Model) =>
  Effect.flatMap(host.available(model), (available) =>
    available
      ? Effect.void
      : Effect.fail(
          new UnknownModel({
            model,
            message: `The model ${model.endpointId}/${model.modelId}${model.variant ? ` (${model.variant})` : ""} is not available.`,
          }),
        ),
  )

const kept = <A extends SessionSettings.Layer>(next: A, previous: A | undefined) =>
  next.settings || !next.hash || !previous ? next : previous

export const make = Effect.fnUntraced(function* (host: Host, options: { readonly model?: Session.Model } = {}) {
  const none = { hash: null }
  const cache = yield* Ref.make<Layers>({ ren: none, organization: none, space: none, agents: [] })
  const override = yield* Ref.make(Option.fromUndefinedOr(options.model))
  const pulls = yield* Semaphore.make(1)
  const refresh = Effect.fnUntraced(function* (model: Option.Option<Session.Model>) {
    const before = yield* Ref.get(cache)
    const read = yield* host.read({
      ...(before.ren.hash && { ren: before.ren.hash }),
      ...(before.organization.hash && { organization: before.organization.hash }),
      ...(before.space.hash && { space: before.space.hash }),
      agents: Object.fromEntries(before.agents.map((agent) => [agent.name, agent.hash])),
    })
    const previous = new Map(before.agents.map((agent) => [agent.name, agent.settings]))
    const layers: Layers = {
      ren: kept(read.ren, before.ren),
      organization: kept(read.organization, before.organization),
      space: kept(read.space, before.space),
      agents: yield* Effect.forEach(read.agents, (agent) => {
        const settings = agent.settings ?? previous.get(agent.name)
        return settings
          ? Effect.succeed({ ...agent, settings })
          : Effect.die(new Error(`Ren sent agent ${agent.name} without settings the brain does not have`))
      }),
    }
    const resolved = yield* resolve(layers, model)
    yield* Effect.forEach([resolved.primary, ...resolved.subagents], (agent) => checkModel(host, agent.model), {
      discard: true,
    })
    yield* Ref.set(cache, layers)
    yield* Ref.set(override, model)
    return resolved
  })
  return {
    pull: pulls.withPermit(Effect.flatMap(Ref.get(override), refresh)),
    setModel: (model) =>
      pulls.withPermit(
        Effect.gen(function* () {
          if (Option.isSome(model)) yield* checkModel(host, model.value)
          return yield* refresh(model)
        }),
      ),
  } satisfies Interface
})
