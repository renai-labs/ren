import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import { Schedule } from "@ren/schema/schedule"
import { Infra } from "@ren/schema/infra"
import { Effect, Schema } from "effect"
import { Agent } from "../src/agent.js"
import { AgentMembership } from "../src/agent/membership.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { OrganizationSettings } from "../src/organization-settings.js"
import { Schedules } from "../src/schedules.js"
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

      const pulled = yield* infra.pull(o.admin, {})

      expect({ bindings: pulled.bindings, spec: pulled.spec }).toEqual({
        bindings: { organization: o.bindings.organization, spaces: {} },
        spec: {
          org: { settings: { ...empty, instructions: "Be brief." } },
          memory: { "memory.md": "" },
          spaces: {
            home: {
              name: "Home",
              settings: empty,
              agents: {},
              apps: {},
              schedules: {},
              channels: {},
              memory: { "memory.md": "" },
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
              memory: { "memory.md": "" },
              uses: { agents: [] },
            },
          },
        },
      })
      expect(pulled).toMatchObject({
        write: [
          "memory/memory.md",
          "org",
          "spaces/engineering",
          "spaces/engineering/agents/build",
          "spaces/engineering/memory/memory.md",
          "spaces/home",
          "spaces/home/memory/memory.md",
          "spaces/home/uses/agents/build",
        ],
        remove: [],
        conflicts: [],
      })
      expect(Object.keys(pulled.lock.resources)).toEqual([...pulled.write])
      expect(yield* infra.plan(o.admin, yield* replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
        lock: pulled.lock,
      })
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
        ...(yield* InfraFixture.pulled(o.admin)),
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
        change("update", "space", "spaces/engineering", {
          fields: ["description", "settings"],
          values: [
            { field: "description", folder: "Builds." },
            { field: "settings.instructions", folder: "Ship it." },
          ],
        }),
        change("create", "space", "spaces/support"),
        change("update", "agent", "spaces/engineering/agents/build", {
          fields: ["settings"],
          values: [{ field: "settings.instructions", folder: "Test first." }],
        }),
        change("create", "agent", "spaces/engineering/agents/review"),
        change("create", "membership", "spaces/home/uses/agents/build"),
        change("create", "membership", "spaces/support/uses/agents/review"),
        change("archive", "agent", "spaces/engineering/agents/lint"),
        change("archive", "space", "spaces/old"),
      ])
      const applied = yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect(applied.changes).toEqual(plan.changes)
      expect(InfraFixture.withoutMemory(applied.lock)).toEqual(
        InfraFixture.withoutMemory((yield* infra.pull(o.admin, {})).lock),
      )
      expect((yield* infra.plan(o.admin, { ...input, lock: applied.lock })).changes).toEqual([])
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
          ...(yield* InfraFixture.pulled(o.admin)),
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

        expect(InfraFixture.withoutValues(plan.changes)).toEqual([
          change("create", "agent", "spaces/home/agents/build"),
          change("create", "agent", "spaces/home/agents/review"),
          change("update", "space", "spaces/home", { fields: ["factory"] }),
        ])
        yield* infra.apply(o.admin, { ...input, digest: plan.digest })
        expect((yield* spaces.get(o.admin, o.home.id)).factory.agents.map((entry) => entry.to?.length)).toEqual([
          1, 1, 1,
        ])
        const pulled = yield* infra.pull(o.admin, {})
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
        ...(yield* InfraFixture.pulled(o.admin)),
        spec: spec({
          home: { name: "Home", uses: { agents: ["tester"] } },
          engineering: { name: "Engineering", renamedFrom: ["eng"] },
          support: { name: "Support", agents: { tester: { renamedFrom: ["qa"] } } },
        }),
      }

      const plan = yield* infra.plan(o.admin, input)

      expect(InfraFixture.withoutValues(plan.changes)).toEqual([
        change("update", "space", "spaces/engineering", { from: "spaces/eng", fields: ["slug"] }),
        change("create", "space", "spaces/support"),
        change("update", "agent", "spaces/support/agents/tester", {
          from: "spaces/eng/agents/qa",
          fields: ["name", "owner"],
        }),
        change("archive", "membership", "spaces/engineering/uses/agents/tester"),
      ])
      const applied = yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect((yield* spaces.get(o.admin, eng.id)).slug).toBe("engineering")
      expect(yield* agents.get(o.admin, qa.id)).toMatchObject({
        name: "tester",
        ownerSpaceId: (yield* spaces.get(o.admin, "support")).id,
      })
      expect((yield* infra.plan(o.admin, { ...input, lock: applied.lock })).changes).toEqual([])
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
      const input = { ...(yield* InfraFixture.pulled(o.admin)), spec: spec({ home: { name: "Home" } }) }

      const plan = yield* infra.plan(o.admin, input)

      expect(plan).toMatchObject({
        changes: [change("archive", "app", `spaces/eng/apps/${slug}`), change("archive", "space", "spaces/eng")],
        problems: [],
      })
      const applied = yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect(yield* infra.plan(o.admin, { ...input, lock: applied.lock })).toMatchObject({ changes: [], problems: [] })
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
      const unchanged = yield* InfraFixture.pulled(o.admin)

      expect((yield* infra.plan(o.admin, unchanged)).problems).toEqual([])
      const plan = yield* infra.plan(o.admin, { ...unchanged, spec: spec({ home: { name: "Home" } }) })
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
      const input = {
        ...(yield* InfraFixture.pulled(o.admin)),
        spec: spec({ home: { name: "Home", description: "Ours." } }),
      }
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
      expect((yield* infra.pull(member, {}).pipe(Effect.flip))._tag).toBe("Primitive.Forbidden")
      expect(
        (yield* infra.plan(o.admin, { ...input, bindings: { organization: "elsewhere", spaces: {} } })).problems,
      ).toEqual([
        {
          path: "deploy.yaml",
          message: `deploy.yaml names “elsewhere”, but you are signed in to “${o.bindings.organization}”.`,
        },
      ])
      const lock = { organization: "elsewhere", resources: {} }
      expect(
        yield* infra.pull(o.admin, { ...input, bindings: { organization: "elsewhere", spaces: {} } }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "Primitive.Invalid",
        message: `deploy.yaml names “elsewhere”, but you are signed in to “${o.bindings.organization}”.`,
      })
      expect(yield* infra.pull(o.admin, { lock }).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Invalid",
        message: `ren.lock is for “elsewhere”, but you are signed in to “${o.bindings.organization}”.`,
      })
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
        {
          path: "deploy.yaml/spaces/gone",
          message: "deploy.yaml binds space “gone”, which the spec does not declare.",
        },
        { path: "deploy.yaml/spaces/home/timezone", message: "Infra does not apply the timezone of a space yet." },
        { path: "deploy.yaml/spaces/home/webhooks", message: "Infra does not apply webhooks yet." },
        { path: "spaces/home/webhooks", message: "Infra does not apply webhooks yet." },
      ])
    }),
  )
  it.live(
    "apply changes only what the folder changed since its lock, and force applies the folder over a conflict",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const agents = yield* Agent.Service
        const infra = yield* InfraSpecs.Service
        const o = yield* org
        const eng = yield* spaces.create(o.admin, { name: "Engineering", slug: "engineering" })
        const agent = (name: string) =>
          agents.create(o.admin, { ownerSpaceId: eng.id, name, isSubagent: false, settings: empty })
        const build = yield* agent("build")
        const docs = yield* agent("docs")
        const lint = yield* agent("lint")
        const review = yield* agent("review")
        const base = yield* InfraFixture.pulled(o.admin)
        yield* Effect.forEach([build, lint, review], (edited) =>
          agents.update(o.admin, edited.id, { description: `${edited.name} in Ren.` }),
        )
        const input = {
          ...base,
          spec: spec({
            home: { name: "Home" },
            engineering: {
              name: "Engineering",
              agents: { build: { description: "build here." }, docs: { description: "docs here." }, review: {} },
            },
          }),
        }

        const plan = yield* infra.plan(o.admin, input)

        expect(plan.changes).toMatchObject([
          change("update", "agent", "spaces/engineering/agents/build", {
            status: "conflict",
            fields: ["description"],
            values: [{ field: "description", ren: "build in Ren.", folder: "build here." }],
          }),
          change("update", "agent", "spaces/engineering/agents/docs", {
            fields: ["description"],
            values: [{ field: "description", folder: "docs here." }],
          }),
          change("update", "agent", "spaces/engineering/agents/review", {
            status: "changed",
            fields: ["description"],
            values: [{ field: "description", ren: "review in Ren." }],
          }),
          { action: "archive", status: "conflict", kind: "agent", path: "spaces/engineering/agents/lint" },
        ])
        const refused = yield* infra.apply(o.admin, { ...input, digest: plan.digest }).pipe(Effect.flip)
        expect(refused).toMatchObject({
          _tag: "Primitive.Conflict",
          message:
            "spaces/engineering/agents/build, spaces/engineering/agents/lint changed in Ren and in the folder. Pull and merge them, or apply with force.",
        })
        expect((yield* agents.get(o.admin, docs.id)).description).toBeNull()

        const forced = yield* infra.apply(o.admin, { ...input, digest: plan.digest, force: true })

        expect(forced.changes.map((change) => change.path)).toEqual([
          "spaces/engineering/agents/build",
          "spaces/engineering/agents/docs",
          "spaces/engineering/agents/lint",
        ])
        expect((yield* agents.get(o.admin, build.id)).description).toBe("build here.")
        expect((yield* agents.get(o.admin, docs.id)).description).toBe("docs here.")
        expect((yield* agents.get(o.admin, review.id)).description).toBe("review in Ren.")
        expect((yield* agents.get(o.admin, lint.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect(
          InfraFixture.withoutValues((yield* infra.plan(o.admin, { ...input, lock: forced.lock })).changes),
        ).toEqual([
          change("update", "agent", "spaces/engineering/agents/review", { status: "changed", fields: ["description"] }),
        ])
      }),
  )

  it.live("a folder without a lock adopts what matches Ren, and leaves what it does not declare", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const design = yield* spaces.create(o.admin, { name: "Design", slug: "design" })
      const input = { bindings: o.bindings, spec: spec({ home: { name: "Home" } }) }

      const plan = yield* infra.plan(o.admin, input)

      expect(InfraFixture.withoutValues(plan.changes)).toEqual([
        change("archive", "space", "spaces/design", { status: "new" }),
      ])
      const applied = yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect(applied.changes).toEqual([])
      expect((yield* spaces.get(o.admin, design.id)).slug).toBe("design")
      const pulled = yield* infra.pull(o.admin, {})
      expect(applied.lock).toEqual({
        organization: o.bindings.organization,
        resources: Object.fromEntries(
          Object.entries(InfraFixture.withoutMemory(pulled.lock).resources).filter(
            (entry) => entry[0] !== "spaces/design",
          ),
        ),
      })
    }),
  )

  it.live("an edit in Ren to a row that the plan does not touch does not stop apply", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const design = yield* spaces.create(o.admin, { name: "Design", slug: "design" })
      const input = {
        ...(yield* InfraFixture.pulled(o.admin)),
        spec: spec({ home: { name: "Home", description: "Ours." }, design: { name: "Design" } }),
      }
      const plan = yield* infra.plan(o.admin, input)

      yield* spaces.update(o.admin, design.id, { name: "Drawing" })

      yield* infra.apply(o.admin, { ...input, digest: plan.digest })
      expect((yield* spaces.get(o.admin, o.home.id)).description).toBe("Ours.")
      expect((yield* spaces.get(o.admin, design.id)).name).toBe("Drawing")
    }),
  )

  it.live("a resource that is the same in the folder and in Ren is in sync, whatever the lock holds", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const build = yield* agents.create(o.admin, {
        ownerSpaceId: o.home.id,
        name: "build",
        isSubagent: false,
        settings: empty,
      })
      const base = yield* InfraFixture.pulled(o.admin)
      yield* agents.update(o.admin, build.id, { description: "Builds." })

      const plan = yield* infra.plan(o.admin, {
        ...base,
        spec: spec({ home: { name: "Home", agents: { build: { description: "Builds." } } } }),
      })

      expect(plan.changes).toEqual([])
      expect(plan.lock).toEqual((yield* infra.pull(o.admin, {})).lock)
    }),
  )

  it.live("pull writes what changed only in Ren, keeps what changed only in the folder, and names each conflict", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const agents = yield* Agent.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const legacy = yield* spaces.create(o.admin, { name: "Legacy", slug: "legacy" })
      const agent = (name: string) =>
        agents.create(o.admin, { ownerSpaceId: o.home.id, name, isSubagent: false, settings: empty })
      const build = yield* agent("build")
      const docs = yield* agent("docs")
      const old = yield* agent("old")
      const review = yield* agent("review")
      const base = yield* InfraFixture.pulled(o.admin)
      yield* agents.update(o.admin, review.id, { description: "Reviews." })
      yield* agents.update(o.admin, docs.id, { description: "Docs in Ren." })
      yield* agents.archive(o.admin, old.id)
      yield* spaces.archive(o.admin, legacy.id)
      const folder = (docs: Record<string, unknown>) => ({
        ...base,
        spec: spec({
          home: { name: "Home", agents: { build: { description: "Builds." }, docs, old: {}, review: {} } },
          legacy: { name: "Legacy", agents: { fresh: {} } },
        }),
      })

      const refused = yield* infra.pull(o.admin, folder({ description: "Docs here." }))

      expect(refused.conflicts).toEqual([
        change("update", "agent", "spaces/home/agents/docs", {
          status: "conflict",
          values: [{ field: "description", ren: "Docs in Ren.", folder: "Docs here." }],
        }),
        change("create", "space", "spaces/legacy", {
          status: "conflict",
          values: [
            { field: "name", folder: "Legacy" },
            { field: "settings.permissions", folder: "[]" },
            { field: "settings.references", folder: "[]" },
          ],
        }),
        change("create", "agent", "spaces/legacy/agents/fresh", {
          status: "conflict",
          values: [
            { field: "isSubagent", folder: "false" },
            { field: "settings.permissions", folder: "[]" },
            { field: "settings.references", folder: "[]" },
          ],
        }),
      ])

      const pulled = yield* infra.pull(o.admin, {
        ...base,
        spec: spec({
          home: { name: "Home", agents: { build: { description: "Builds." }, docs: {}, old: {}, review: {} } },
          legacy: { name: "Legacy" },
        }),
      })

      expect(pulled).toMatchObject({
        write: [
          "memory/memory.md",
          "spaces/home/agents/docs",
          "spaces/home/agents/review",
          "spaces/home/memory/memory.md",
        ],
        remove: ["spaces/home/agents/old", "spaces/legacy"],
        conflicts: [],
      })
      const fresh = (yield* infra.pull(o.admin, {})).lock.resources
      const path = (agent: string) => `spaces/home/agents/${agent}`
      expect(pulled.lock.resources[path(build.name)]).toBe(base.lock?.resources[path(build.name)])
      expect(pulled.lock.resources[path(review.name)]).toBe(fresh[path(review.name)])
      expect(pulled.lock.resources[path(old.name)]).toBeUndefined()
    }),
  )
  it.live("archiving a space that holds a resource apply would leave is a conflict, and apply writes nothing", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const schedules = yield* Schedules.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const eng = yield* spaces.create(o.admin, { name: "Engineering", slug: "engineering" })
      const base = yield* InfraFixture.pulled(o.admin)
      yield* schedules.create(
        o.admin,
        Schema.decodeUnknownSync(Schedule.CreateInput)({
          spaceId: eng.id,
          name: "Nightly",
          slug: "nightly",
          message: "Run it.",
          when: { cron: "0 3 * * *", timeZone: "UTC" },
        }),
      )
      const input = { ...base, spec: spec({ home: { name: "Home", description: "Ours." } }) }

      const plan = yield* infra.plan(o.admin, input)

      expect(InfraFixture.withoutValues(plan.changes)).toEqual([
        change("update", "space", "spaces/home", { fields: ["description"] }),
        change("archive", "schedule", "spaces/engineering/schedules/nightly", { status: "conflict" }),
        change("archive", "space", "spaces/engineering", { status: "conflict" }),
      ])
      expect((yield* infra.apply(o.admin, { ...input, digest: plan.digest }).pipe(Effect.flip))._tag).toBe(
        "Primitive.Conflict",
      )
      expect((yield* spaces.get(o.admin, o.home.id)).description).toBeNull()
      expect((yield* schedules.list(o.admin, { spaceId: eng.id, page: 1, pageSize: 10 })).items).toHaveLength(1)
    }),
  )

  it.live("a resource that the folder adds to a space that Ren archived is a conflict", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const eng = yield* spaces.create(o.admin, { name: "Engineering", slug: "engineering" })
      const base = yield* InfraFixture.pulled(o.admin)
      yield* spaces.archive(o.admin, eng.id)

      const plan = yield* infra.plan(o.admin, {
        ...base,
        spec: spec({ home: { name: "Home" }, engineering: { name: "Engineering", agents: { docs: {} } } }),
      })

      expect(InfraFixture.withoutValues(plan.changes)).toEqual([
        change("create", "space", "spaces/engineering", { status: "conflict" }),
        change("create", "agent", "spaces/engineering/agents/docs", { status: "conflict" }),
      ])
    }),
  )

  it.live("pull refuses to write a resource into a space that the folder deleted", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const agents = yield* Agent.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* org
      const drafts = yield* spaces.create(o.admin, { name: "Drafts", slug: "drafts" })
      const base = yield* InfraFixture.pulled(o.admin)
      yield* agents.create(o.admin, { ownerSpaceId: drafts.id, name: "draft", isSubagent: false, settings: empty })

      const pulled = yield* infra.pull(o.admin, { ...base, spec: spec({ home: { name: "Home" } }) })

      expect(pulled.conflicts.map((conflict) => [conflict.action, conflict.path])).toEqual([
        ["archive", "spaces/drafts"],
        ["archive", "spaces/drafts/agents/draft"],
      ])
    }),
  )
})
