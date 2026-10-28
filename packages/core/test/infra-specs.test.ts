import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import { Infra } from "@ren/schema/infra"
import { Effect, Schema } from "effect"
import { Agent } from "../src/agent.js"
import { AgentMembership } from "../src/agent/membership.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { OrganizationSettings } from "../src/organization-settings.js"
import { Space } from "../src/space.js"
import { SpaceSettings } from "../src/space/settings.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const empty = InfraFixture.empty

const spec = InfraFixture.spec

const org = InfraFixture.org

const privateSpace = InfraFixture.privateSpace

const replan = InfraFixture.replan

const change = InfraFixture.change

describe("InfraSpecs", () => {
  it.live("pull writes the shared spaces with their agents, settings and uses, and its plan has no changes", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const spaceSettings = yield* SpaceSettings.Service
      const organizationSettings = yield* OrganizationSettings.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      yield* organizationSettings.update(o.admin, o.organizationId, {
        settings: { ...empty, instructions: "Be brief." },
      })
      const eng = yield* spaces.create(o.admin, { name: "Engineering", slug: "engineering", description: "Builds." })
      yield* spaceSettings.update(o.admin, eng.id, { settings: { ...empty, instructions: "Ship it." } })
      const build = yield* agents.create(o.admin, {
        ownerSpaceId: eng.id,
        name: "build",
        description: "Writes code.",
        isSubagent: false,
        settings: { ...empty, instructions: "Test first." },
      })
      yield* memberships.create(o.admin, { agentId: build.id, spaceId: o.home.id })
      yield* Seed.agent({ organizationId: o.organizationId, spaceId: yield* privateSpace(o, "own") }, "notes", {
        isSubagent: false,
      })

      const pulled = yield* infra.pull(o.admin)

      expect(pulled).toEqual({
        bindings: { organization: o.bindings.organization, spaces: {} },
        spec: {
          org: { settings: { ...empty, instructions: "Be brief." } },
          spaces: {
            home: {
              name: "Home",
              settings: empty,
              agents: {},
              apps: {},
              schedules: {},
              channels: {},
              uses: { agents: ["build"] },
            },
            engineering: {
              name: "Engineering",
              description: "Builds.",
              settings: { ...empty, instructions: "Ship it." },
              agents: {
                build: {
                  description: "Writes code.",
                  isSubagent: false,
                  settings: { ...empty, instructions: "Test first." },
                },
              },
              apps: {},
              schedules: {},
              channels: {},
              uses: { agents: [] },
            },
          },
        },
      })
      expect(yield* infra.plan(o.admin, yield* replan(pulled))).toMatchObject({ changes: [], problems: [] })
    }),
  )

  it.live("apply makes the organization match the plan: creates and updates first, then archives", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const agents = yield* Agent.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const eng = yield* spaces.create(o.admin, { name: "Engineering", slug: "engineering" })
      yield* spaces.create(o.admin, { name: "Old", slug: "old" })
      const build = yield* agents.create(o.admin, {
        ownerSpaceId: eng.id,
        name: "build",
        isSubagent: false,
        settings: empty,
      })
      const lint = yield* agents.create(o.admin, {
        ownerSpaceId: eng.id,
        name: "lint",
        isSubagent: false,
        settings: empty,
      })
      const input = {
        bindings: o.bindings,
        spec: spec({
          home: { name: "Home", uses: { agents: ["build"] } },
          engineering: {
            name: "Engineering",
            description: "Builds.",
            settings: { instructions: "Ship it." },
            agents: { build: { settings: { instructions: "Test first." } }, review: { description: "Reviews." } },
          },
          support: { name: "Support", uses: { agents: ["review"] } },
        }),
      }

      const plan = yield* infra.plan(o.admin, input)

      expect(plan.problems).toEqual([])
      expect(plan.changes).toEqual([
        change("update", "space", "spaces/engineering", { fields: ["description", "settings"] }),
        change("create", "space", "spaces/support"),
        change("update", "agent", "spaces/engineering/agents/build", { fields: ["settings"] }),
        change("create", "agent", "spaces/engineering/agents/review"),
        change("create", "membership", "spaces/home/uses/agents/build"),
        change("create", "membership", "spaces/support/uses/agents/review"),
        change("archive", "agent", "spaces/engineering/agents/lint"),
        change("archive", "space", "spaces/old"),
      ])
      expect((yield* infra.apply(o.admin, { ...input, digest: plan.digest })).changes).toEqual(plan.changes)
      expect((yield* infra.plan(o.admin, input)).changes).toEqual([])
      expect((yield* agents.get(o.admin, build.id)).settings.instructions).toBe("Test first.")
      expect((yield* agents.get(o.admin, lint.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live(
    "a factory names agents: apply writes it after the agents that it names, and pull writes the names back",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const infra = yield* InfraSpecs.Service
        yield* Seed.ren()
        const o = yield* org
        const input = {
          bindings: o.bindings,
          spec: spec({
            home: {
              name: "Home",
              agents: { build: {}, review: {} },
              factory: {
                maxHandoffs: 8,
                agents: [
                  { agent: "ren", to: [{ agent: "build" }] },
                  { agent: "build", maxRuns: 3, to: [{ agent: "review" }] },
                  { agent: "review", to: [{ agent: "build", max: 2, else: "ren", start: "continue" }] },
                ],
              },
            },
          }),
        }

        const plan = yield* infra.plan(o.admin, input)

        expect(plan.changes).toEqual([
          change("create", "agent", "spaces/home/agents/build"),
          change("create", "agent", "spaces/home/agents/review"),
          change("update", "space", "spaces/home", { fields: ["factory"] }),
        ])
        yield* infra.apply(o.admin, { ...input, digest: plan.digest })
        expect((yield* spaces.get(o.admin, o.home.id)).factory.agents.map((entry) => entry.to?.length)).toEqual([
          1, 1, 1,
        ])
        const pulled = yield* infra.pull(o.admin)
        expect(pulled.spec.spaces["home"]?.factory).toEqual(input.spec.spaces["home"]?.factory)
        expect(yield* infra.plan(o.admin, yield* replan(pulled))).toMatchObject({ changes: [], problems: [] })
      }),
  )

  it.live("renamedFrom keeps the row of a renamed space or agent, and moving an agent's folder transfers it", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const agents = yield* Agent.Service
      const memberships = yield* AgentMembership.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const eng = yield* spaces.create(o.admin, { name: "Engineering", slug: "eng" })
      const qa = yield* agents.create(o.admin, { ownerSpaceId: eng.id, name: "qa", isSubagent: false, settings: empty })
      yield* memberships.create(o.admin, { agentId: qa.id, spaceId: o.home.id })
      const input = {
        bindings: o.bindings,
        spec: spec({
          home: { name: "Home", uses: { agents: ["tester"] } },
          engineering: { name: "Engineering", renamedFrom: ["eng"] },
          support: { name: "Support", agents: { tester: { renamedFrom: ["qa"] } } },
        }),
      }

      const plan = yield* infra.plan(o.admin, input)

      expect(plan.changes).toEqual([
        change("update", "space", "spaces/engineering", { from: "spaces/eng", fields: ["slug"] }),
        change("create", "space", "spaces/support"),
        change("update", "agent", "spaces/support/agents/tester", {
          from: "spaces/eng/agents/qa",
          fields: ["name", "owner"],
        }),
        change("archive", "membership", "spaces/engineering/uses/agents/tester"),
      ])
      yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect((yield* spaces.get(o.admin, eng.id)).slug).toBe("engineering")
      expect(yield* agents.get(o.admin, qa.id)).toMatchObject({
        name: "tester",
        ownerSpaceId: (yield* spaces.get(o.admin, "support")).id,
      })
      expect((yield* infra.plan(o.admin, input)).changes).toEqual([])
    }),
  )

  it.live("each live row matches one declaration, and each declaration one live row", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const agents = yield* Agent.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const eng = yield* spaces.create(o.admin, { name: "Eng", slug: "eng" })
      yield* agents.create(o.admin, { ownerSpaceId: eng.id, name: "qa", isSubagent: false, settings: empty })
      yield* agents.create(o.admin, { ownerSpaceId: eng.id, name: "lint", isSubagent: false, settings: empty })

      const plan = yield* infra.plan(o.admin, {
        bindings: o.bindings,
        spec: spec({
          home: { name: "Home" },
          engineering: {
            name: "Engineering",
            renamedFrom: ["eng"],
            agents: { tester: { renamedFrom: ["qa", "lint"] } },
          },
          platform: { name: "Platform", renamedFrom: ["eng"] },
        }),
      })

      expect(plan.problems).toEqual([
        { path: "spaces/engineering", message: "spaces/platform is also renamed from “eng”. Only one can be." },
        {
          path: "spaces/engineering/agents/tester",
          message: "More than one live agent matches: “lint”, “qa”. Keep one, and archive the others in the app.",
        },
        { path: "spaces/platform", message: "spaces/engineering is also renamed from “eng”. Only one can be." },
      ])
    }),
  )

  it.live("a plan archives the apps of a space it archives, before the space", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const database = yield* Database.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const eng = yield* spaces.create(o.admin, { name: "Eng", slug: "eng" })
      const slug = `notes-${eng.id.toLowerCase()}`
      yield* database.db.insert(Database.Schema.app).values({
        id: App.ID.create(),
        slug,
        organization_id: o.organizationId,
        owner_space_id: eng.id,
        name: "Notes",
        description: "Writes notes.",
        required_credentials: [],
        mcps: {},
        skills: {},
      })
      const input = { bindings: o.bindings, spec: spec({ home: { name: "Home" } }) }

      const plan = yield* infra.plan(o.admin, input)

      expect(plan).toMatchObject({
        changes: [change("archive", "app", `spaces/eng/apps/${slug}`), change("archive", "space", "spaces/eng")],
        problems: [],
      })
      yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect(yield* infra.plan(o.admin, input)).toMatchObject({ changes: [], problems: [] })
    }),
  )

  it.live("a name that a row outside the spec holds is taken, and the problem does not say where", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      yield* Seed.agent({ organizationId: o.organizationId, spaceId: yield* privateSpace(o, "notes") }, "build", {
        isSubagent: false,
      })

      const plan = yield* infra.plan(o.admin, {
        bindings: o.bindings,
        spec: spec({ home: { name: "Home", agents: { build: {} } }, notes: { name: "Notes" } }),
      })

      expect(plan.problems).toEqual([
        { path: "spaces/home/agents/build", message: "Agent name “build” is already taken. Choose another name." },
        { path: "spaces/notes", message: "Space slug “notes” is already taken. Choose another slug." },
      ])
    }),
  )

  it.live("a plan that changes a space needs the person who applies it to be a member", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const agents = yield* Agent.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const grace = yield* Seed.actor(o.organizationId, "member")
      const design = yield* spaces.create(grace, { name: "Design", slug: "design" })
      yield* agents.create(grace, { ownerSpaceId: design.id, name: "draw", isSubagent: false, settings: empty })
      const unchanged = yield* replan(yield* infra.pull(o.admin))

      expect((yield* infra.plan(o.admin, unchanged)).problems).toEqual([])
      const plan = yield* infra.plan(o.admin, { bindings: o.bindings, spec: spec({ home: { name: "Home" } }) })
      expect(plan.problems).toEqual([
        { path: "spaces/design", message: "Join this space first: the plan changes it, and only its members can." },
      ])
      const failed = yield* infra
        .apply(o.admin, { ...unchanged, spec: spec({ home: { name: "Home" } }), digest: plan.digest })
        .pipe(Effect.flip)
      expect(failed.message).toBe("The plan has problems. Run ren infra plan to see them.")
    }),
  )

  it.live("apply refuses a plan that is stale", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const input = { bindings: o.bindings, spec: spec({ home: { name: "Home", description: "Ours." } }) }
      const plan = yield* infra.plan(o.admin, input)

      yield* spaces.update(o.admin, o.home.id, { name: "House" })

      const failed = yield* infra.apply(o.admin, { ...input, digest: plan.digest }).pipe(Effect.flip)
      expect(failed).toMatchObject({
        _tag: "Primitive.Conflict",
        message: "The plan is stale. Run ren infra plan again.",
      })
      expect((yield* spaces.get(o.admin, o.home.id)).description).toBeNull()
    }),
  )

  it.live("only an admin of the organization that deploy.yaml names plans the org spec", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const member = yield* Seed.actor(o.organizationId, "member")
      const input = { bindings: o.bindings, spec: spec({ home: { name: "Home" } }) }

      expect((yield* infra.plan(member, input).pipe(Effect.flip))._tag).toBe("Primitive.Forbidden")
      expect((yield* infra.pull(member).pipe(Effect.flip))._tag).toBe("Primitive.Forbidden")
      expect(
        (yield* infra.plan(o.admin, { ...input, bindings: { organization: "elsewhere", spaces: {} } })).problems,
      ).toEqual([
        {
          path: "deploy.yaml",
          message: `deploy.yaml names “elsewhere”, but you are signed in to “${o.bindings.organization}”.`,
        },
      ])
    }),
  )

  it.live("plan refuses the kinds that infra does not apply yet", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* org

      const plan = yield* infra.plan(o.admin, {
        bindings: Schema.decodeUnknownSync(Infra.Bindings)({
          organization: o.bindings.organization,
          spaces: { home: { timezone: "Asia/Kolkata", webhooks: { hook: { secret: "HOOK" } } }, gone: {} },
        }),
        spec: spec({ home: { name: "Home", webhooks: { hook: { purpose: "Deploys." } } } }),
      })

      expect(plan.problems).toEqual([
        { path: "deploy.yaml/spaces/gone", message: "deploy.yaml binds space “gone”, which the spec does not declare." },
        { path: "deploy.yaml/spaces/home/timezone", message: "Infra does not apply the timezone of a space yet." },
        { path: "deploy.yaml/spaces/home/webhooks", message: "Infra does not apply webhooks yet." },
        { path: "spaces/home/webhooks", message: "Infra does not apply webhooks yet." },
      ])
    }),
  )
})
