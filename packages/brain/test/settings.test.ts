import { describe, expect, test } from "bun:test"
import type { Permission } from "@ren/schema/permission"
import type { SessionSettings } from "@ren/schema/session-settings"
import type { Settings } from "@ren/schema/settings"
import { Effect, Option } from "effect"
import { BrainSettings } from "../src/settings.js"

const layer = (settings: Partial<Settings.Info>): Settings.Info => ({ permissions: [], references: [], ...settings })

const stub = { endpointId: "stub", modelId: "stub-model" }

const available = new Set(["stub/stub-model", "stub/stub-model/high", "stub/small"])

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

const ren = (initial: Stored) => {
  const state = { stored: initial, sent: [] as Array<SessionSettings.Known> }
  const owned = (settings: Settings.Info | undefined, known: string | undefined) => {
    if (!settings) return { hash: null }
    const hash = hashOf(settings)
    return hash === known ? { hash } : { hash, settings }
  }
  const host: BrainSettings.Host = {
    read: (known) =>
      Effect.sync(() => {
        state.sent.push(known)
        return {
          ren: owned(state.stored.ren, known.ren),
          organization: owned(state.stored.organization, known.organization),
          space: owned(state.stored.space, known.space),
          agents: state.stored.agents.map((agent) => {
            const hash = hashOf(agent)
            const base = { name: agent.name, description: null, isSubagent: agent.isSubagent, hash }
            return hash === known.agents?.[agent.name] ? base : { ...base, settings: agent.settings }
          }),
        }
      }),
    available: (model) =>
      Effect.succeed(available.has([model.endpointId, model.modelId, model.variant].filter(Boolean).join("/"))),
  }
  return { state, host }
}

const primary = (settings: Partial<Settings.Info> = {}) => ({
  name: "ren",
  isSubagent: false,
  settings: layer(settings),
})

const pull = (stored: Stored) => Effect.flatMap(BrainSettings.make(ren(stored).host), (brain) => brain.pull)

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const rule = (action: string, resource: string, effect: Permission.RuleEffect) => ({ action, resource, effect })

describe("BrainSettings.pull", () => {
  test("the main agent gets the layers' instructions in order and the last model set; a subagent gets its own instructions and falls back to that model", async () => {
    const resolved = await run(
      pull({
        ren: layer({ instructions: "House rules.", model: stub }),
        organization: layer({ instructions: "Never print secrets." }),
        space: layer({ instructions: "We use Bun.", model: { ...stub, variant: "high" } }),
        agents: [
          primary({ instructions: "You are Ren." }),
          { name: "explore", isSubagent: true, settings: layer({ instructions: "You search." }) },
          { name: "quick", isSubagent: true, settings: layer({ model: { endpointId: "stub", modelId: "small" } }) },
        ],
      }),
    )
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

  test("a pull sends the hashes it has, keeps the layers that did not change and drops an agent that is gone", async () => {
    const fake = ren({
      ren: layer({ instructions: "House rules.", model: stub }),
      space: layer({ instructions: "We use Bun." }),
      agents: [primary(), { name: "explore", isSubagent: true, settings: layer({ instructions: "You search." }) }],
    })
    const brain = await run(BrainSettings.make(fake.host))
    await run(brain.pull)
    fake.state.stored = { ...fake.state.stored, space: layer({ instructions: "We use Bun 1.3." }), agents: [primary()] }
    const second = await run(brain.pull)
    expect(fake.state.sent[0]).toEqual({ agents: {} })
    expect(Object.keys(fake.state.sent[1] ?? {})).toEqual(["ren", "space", "agents"])
    expect(second.primary.instructions).toEqual(["House rules.", "We use Bun 1.3."])
    expect(second.subagents).toEqual([])
  })
})

describe("BrainSettings.setModel", () => {
  test("the session's model wins for the main agent and each subagent without a model; a model outside the catalog fails and keeps the last one", async () => {
    const small = { endpointId: "stub", modelId: "small" }
    const fake = ren({
      ren: layer({ model: stub }),
      agents: [
        primary(),
        { name: "explore", isSubagent: true, settings: layer({}) },
        { name: "pinned", isSubagent: true, settings: layer({ model: { ...stub, variant: "high" } }) },
      ],
    })
    const models = (resolved: BrainSettings.Resolved) =>
      [resolved.primary, ...resolved.subagents].map((agent) => agent.model.modelId)
    const brain = await run(BrainSettings.make(fake.host, { model: small }))
    expect(models(await run(brain.pull))).toEqual(["small", "small", "stub-model"])
    const unknown = await run(Effect.flip(brain.setModel(Option.some({ ...stub, variant: "max" }))))
    expect(unknown).toMatchObject({
      _tag: "BrainSettings.UnknownModel",
      message: expect.stringContaining("stub/stub-model (max)"),
    })
    expect(models(await run(brain.pull))).toEqual(["small", "small", "stub-model"])
    expect(models(await run(brain.setModel(Option.none())))).toEqual(["stub-model", "stub-model", "stub-model"])
  })
})

describe("BrainSettings.evaluate", () => {
  const agent = (permissions: Permission.RuleList) =>
    run(pull({ ren: layer({ model: stub, permissions }), agents: [primary()] })).then((resolved) => resolved.primary)
  const interactive = { interactive: true, denied: [] }

  test("deny beats ask, ask beats allow, no rule allows, and the strictest resource decides", async () => {
    const shell = await agent([rule("shell", "git push *", "ask"), rule("shell", "git push --force*", "deny")])
    const decide = (...resources: Array<string>) =>
      BrainSettings.evaluate(shell, { action: "shell", resources }, interactive).effect
    expect(decide("ls")).toBe("allow")
    expect(decide("git push")).toBe("ask")
    expect(decide("git push origin main")).toBe("ask")
    expect(decide("git push --force")).toBe("deny")
    expect(decide("ls", "git push origin")).toBe("ask")
  })

  test("in a session no one can answer, an ask becomes a deny with a message", async () => {
    const decision = BrainSettings.evaluate(
      await agent([rule("read", "*.env", "ask")]),
      { action: "read", resources: ["app/.env"] },
      { interactive: false, denied: [] },
    )
    expect(decision.effect).toBe("deny")
    expect(decision.message).toContain("needs approval")
  })

  test("a subagent keeps the main agent's rules on top of its own", async () => {
    const resolved = await run(
      pull({
        ren: layer({ model: stub }),
        agents: [
          primary({ permissions: [rule("edit", "*", "ask")] }),
          { name: "explore", isSubagent: true, settings: layer({ permissions: [rule("shell", "*", "deny")] }) },
        ],
      }),
    )
    expect(resolved.subagents.map((agent) => agent.permissions)).toEqual([
      [rule("edit", "*", "ask"), rule("shell", "*", "deny")],
    ])
  })

  test("a deny for every resource hides the tool, and a narrower deny keeps it", async () => {
    const resolved = await agent([
      rule("shell", "*", "deny"),
      rule("edit", "/references/*", "deny"),
      rule("webfetch", "*", "ask"),
    ])
    expect(BrainSettings.hiddenTools(resolved, [rule("question", "*", "deny")])).toEqual(["shell", "question"])
  })
})
