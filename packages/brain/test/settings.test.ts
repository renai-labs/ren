import { describe, expect, test } from "bun:test"
import type { Permission } from "@ren/schema/permission"
import type { Session } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import type { Settings } from "@ren/schema/settings"
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

const read = (stored: Stored, known: SessionSettings.Known = {}): SessionSettings.Layers => {
  const owned = (settings: Settings.Info | undefined, hash: string | undefined) => {
    if (!settings) return { hash: null }
    const current = hashOf(settings)
    return current === hash ? { hash: current } : { hash: current, settings }
  }
  return {
    ren: owned(stored.ren, known.ren),
    organization: owned(stored.organization, known.organization),
    space: owned(stored.space, known.space),
    agents: stored.agents.map((agent) => {
      const hash = hashOf(agent)
      const base = { name: agent.name, description: null, isSubagent: agent.isSubagent, hash }
      return hash === known.agents?.[agent.name] ? base : { ...base, settings: agent.settings }
    }),
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
      BrainSettings.merge(BrainSettings.empty, read(stored)),
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
      BrainSettings.merge(
        BrainSettings.empty,
        read({ ren: layer({ model: { endpointId: "gone", modelId: "x" } }), agents: [primary()] }),
      ),
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

describe("BrainSettings.merge", () => {
  test("a pull sends the hashes it has, keeps the layers that did not change and drops an agent that is gone", () => {
    const first: Stored = {
      ren: layer({ instructions: "House rules.", model: stub }),
      space: layer({ instructions: "We use Bun." }),
      agents: [primary(), { name: "explore", isSubagent: true, settings: layer({ instructions: "You search." }) }],
    }
    const merged = BrainSettings.merge(BrainSettings.empty, read(first))
    const known = BrainSettings.known(merged)
    const second: Stored = { ...first, space: layer({ instructions: "We use Bun 1.3." }), agents: [primary()] }
    const reply = read(second, known)
    expect(reply.ren.settings).toBeUndefined()
    const next = Result.getOrThrow(
      BrainSettings.resolve(BrainSettings.merge(merged, reply), { agent: null, model: Option.none() }, lookup),
    )
    expect(Object.keys(known)).toEqual(["ren", "space", "agents"])
    expect(next.primary.instructions).toEqual(["House rules.", "We use Bun 1.3."])
    expect(next.subagents).toEqual([])
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
