import { describe, expect, test } from "bun:test"
import type { Permission } from "@ren/schema/permission"
import type { Session } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import { Settings } from "@ren/schema/settings"
import { Option, Result } from "effect"
import { BrainSettings } from "../src/settings.js"

const layer = (settings: Partial<Settings.Info>): Settings.Info => ({ permissions: [], references: [], ...settings })

const stub = { endpointId: "stub", modelId: "stub-model" }

const catalog: Readonly<Record<string, ReadonlyArray<string>>> = {
  "stub/stub-model": ["low", "high"],
  "stub/small": [],
}

const lookup: BrainSettings.Lookup = (model) =>
  Option.map(Option.fromUndefinedOr(catalog[`${model.endpointId}/${model.modelId}`]), (variants) => ({ variants }))

interface Stored {
  readonly ren?: Settings.Info
  readonly organization?: Settings.Info
  readonly space?: Settings.Info
  readonly agents: ReadonlyArray<{
    readonly name: string
    readonly isSubagent: boolean
    readonly settings: Settings.Info
  }>
}

const hashOf = (value: unknown) => Bun.hash(JSON.stringify(value)).toString()

const read = (stored: Stored): SessionSettings.Layers => {
  const owned = (settings: Settings.Info | undefined) =>
    settings ? { hash: hashOf(settings), settings } : { hash: null }
  return {
    ren: owned(stored.ren),
    organization: owned(stored.organization),
    space: owned(stored.space),
    agents: stored.agents.map((agent) => ({
      name: agent.name,
      description: null,
      isSubagent: agent.isSubagent,
      hash: hashOf(agent),
      settings: agent.settings,
    })),
  }
}

const primary = (settings: Partial<Settings.Info> = {}, name = "ren") => ({
  name,
  isSubagent: false,
  settings: layer(settings),
})

const resolve = (
  stored: Stored,
  chat: { readonly agent?: string; readonly model?: Session.Model } = {},
): BrainSettings.Resolved =>
  Result.getOrThrow(
    BrainSettings.resolve(
      read(stored),
      { agent: chat.agent ?? null, model: Option.fromUndefinedOr(chat.model) },
      lookup,
    ),
  )

const rule = (action: string, resource: string, effect: Permission.RuleEffect) => ({ action, resource, effect })

describe("BrainSettings.resolve", () => {
  test("the main agent gets the layers' instructions in order and the most specific model; a subagent gets its own instructions and falls back to that model", () => {
    const resolved = resolve({
      ren: layer({ instructions: "House rules.", model: stub }),
      organization: layer({ instructions: "Never print secrets." }),
      space: layer({ instructions: "We use Bun.", model: { ...stub, variant: "high" } }),
      agents: [
        primary({ instructions: "You are Ren." }),
        { name: "explore", isSubagent: true, settings: layer({ instructions: "You search." }) },
        { name: "quick", isSubagent: true, settings: layer({ model: { endpointId: "stub", modelId: "small" } }) },
      ],
    })
    expect(resolved.primary).toMatchObject({
      name: "ren",
      instructions: ["House rules.", "Never print secrets.", "We use Bun.", "You are Ren."],
      model: { ...stub, variant: "high" },
    })
    expect(resolved.subagents.map((agent) => [agent.name, agent.instructions, agent.model])).toEqual([
      ["explore", ["House rules.", "Never print secrets.", "We use Bun.", "You search."], { ...stub, variant: "high" }],
      ["quick", ["House rules.", "Never print secrets.", "We use Bun."], { endpointId: "stub", modelId: "small" }],
    ])
  })

  test("each chat resolves its own primary agent from the same layers", () => {
    const stored = {
      ren: layer({ model: stub }),
      agents: [primary({ instructions: "You are Ren." }), primary({ instructions: "You review." }, "reviewer")],
    }
    expect(resolve(stored).primary.instructions).toEqual(["You are Ren."])
    expect(resolve(stored, { agent: "reviewer" }).primary.instructions).toEqual(["You review."])
  })

  test("an agent's steps come from the most specific layer that sets them, else the default", () => {
    const resolved = resolve({
      ren: layer({ model: stub }),
      space: layer({ steps: 40 }),
      agents: [
        primary({ steps: 12 }),
        { name: "explore", isSubagent: true, settings: layer({}) },
        { name: "quick", isSubagent: true, settings: layer({ steps: 5 }) },
      ],
    })
    expect([resolved.primary.steps, ...resolved.subagents.map((agent) => agent.steps)]).toEqual([12, 40, 5])
    expect(resolve({ ren: layer({ model: stub }), agents: [primary()] }).primary.steps).toBe(Settings.defaultSteps)
  })

  test("an unavailable agent model falls back to the space's model, and an unavailable subagent model to the primary's (E61)", () => {
    const resolved = resolve({
      space: layer({ model: stub }),
      agents: [
        primary({ model: { endpointId: "gone", modelId: "old" } }),
        { name: "quick", isSubagent: true, settings: layer({ model: { endpointId: "gone", modelId: "tiny" } }) },
      ],
    })
    expect(resolved.primary.model).toEqual(stub)
    expect(resolved.subagents.at(0)?.model).toEqual(stub)
  })

  test("an unavailable chat pick falls back to the layers; no available model fails (E61)", () => {
    expect(
      resolve({ ren: layer({ model: stub }), agents: [primary()] }, { model: { endpointId: "gone", modelId: "x" } })
        .primary.model,
    ).toEqual(stub)
    const failed = BrainSettings.resolve(
      read({ ren: layer({ model: { endpointId: "gone", modelId: "x" } }), agents: [primary()] }),
      { agent: null, model: Option.none() },
      lookup,
    )
    expect(Result.isFailure(failed) && failed.failure.message).toBe("No available model is set.")
  })

  test("a variant the model no longer offers becomes its first variant (E62)", () => {
    expect(resolve({ ren: layer({ model: { ...stub, variant: "max" } }), agents: [primary()] }).primary.model).toEqual({
      ...stub,
      variant: "low",
    })
  })

  test("the same layers resolve to byte-identical settings", () => {
    const stored = { ren: layer({ model: stub, instructions: "House rules." }), agents: [primary()] }
    expect(JSON.stringify(resolve(stored))).toBe(JSON.stringify(resolve(stored)))
  })
})

describe("BrainSettings.evaluate", () => {
  const agent = (permissions: Permission.RuleList) =>
    resolve({ ren: layer({ model: stub, permissions }), agents: [primary()] }).primary
  const interactive = { interactive: true, denied: [] }

  test("deny beats ask, ask beats allow, no rule allows, and the strictest resource decides", () => {
    const shell = agent([rule("shell", "git push *", "ask"), rule("shell", "git push --force*", "deny")])
    const decide = (...resources: Array<string>) =>
      BrainSettings.evaluate(shell, { action: "shell", resources }, interactive).effect
    expect(decide("ls")).toBe("allow")
    expect(decide("git push")).toBe("ask")
    expect(decide("git push origin main")).toBe("ask")
    expect(decide("git push --force")).toBe("deny")
    expect(decide("ls", "git push origin")).toBe("ask")
  })

  test("in a session no one can answer, an ask becomes a deny with a message", () => {
    const decision = BrainSettings.evaluate(
      agent([rule("read", "*.env", "ask")]),
      { action: "read", resources: ["app/.env"] },
      { interactive: false, denied: [] },
    )
    expect(decision.effect).toBe("deny")
    expect(decision.message).toContain("needs approval")
  })

  test("a subagent keeps the main agent's rules on top of its own", () => {
    const resolved = resolve({
      ren: layer({ model: stub }),
      agents: [
        primary({ permissions: [rule("edit", "*", "ask")] }),
        { name: "explore", isSubagent: true, settings: layer({ permissions: [rule("shell", "*", "deny")] }) },
      ],
    })
    expect(resolved.subagents.map((each) => each.permissions)).toEqual([
      [rule("edit", "*", "ask"), rule("shell", "*", "deny")],
    ])
  })
})
