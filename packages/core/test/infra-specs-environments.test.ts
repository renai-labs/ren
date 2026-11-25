import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Infra } from "@ren/schema/infra"
import { MachineProvider } from "@ren/schema/machine-provider"
import type { Space as SpaceSchema } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Actor } from "../src/actor.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { MachineTemplates } from "../src/machine-templates.js"
import { Space } from "../src/space.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const change = InfraFixture.change

const python = {
  provider: "test",
  config: { label: "python" },
  sessionsPerEnvironment: 2,
  networking: { type: "unrestricted" },
} as const

const folder = (
  o: { readonly bindings: ReturnType<typeof InfraFixture.bindings> },
  spaces: Record<string, unknown>,
  environments: Record<string, unknown>,
) => ({ bindings: o.bindings, spec: InfraFixture.spec(spaces, {}, {}, environments) })

const listed = Effect.fnUntraced(function* (actor: Actor.Info) {
  const templates = yield* MachineTemplates.Service
  return (yield* templates.list(actor, { page: 1, pageSize: 50 })).items
})

const hand = Effect.fnUntraced(function* (actor: Actor.Info, id: SpaceSchema.ID) {
  const spaces = yield* Space.Service
  return (yield* spaces.get(actor, id)).hand
})

describe("InfraSpecs environments", () => {
  it.live("pull writes the org's environment templates and each shared space's runtime, and its plan is empty", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const spaces = yield* Space.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const provider = MachineProvider.ID.make("test")
      const made = yield* templates.create(o.admin, { ...python, provider, name: "Python", description: "Data work." })
      yield* spaces.update(o.admin, o.home.id, {
        brainScope: "session",
        brain: { provider, environmentTemplateId: made.id },
        hand: { placement: "remote", environmentTemplateId: made.id },
      })

      const pulled = yield* infra.pull(o.admin, {})

      expect(Schema.encodeSync(Infra.Pulled)(pulled).spec.environments).toEqual({
        Python: { ...python, description: "Data work." },
      })
      expect(pulled.spec.spaces["home"]).toMatchObject({
        brainScope: "session",
        brain: { environment: "Python" },
        hand: { placement: "remote", environment: "Python" },
      })
      expect(pulled.write).toContain("environments/Python")
      expect(yield* infra.plan(o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
        lock: pulled.lock,
      })
    }),
  )

  it.live(
    "apply creates a template from the folder, updates what changed, and archives it when the folder drops it",
    () =>
      Effect.gen(function* () {
        const infra = yield* InfraSpecs.Service
        const templates = yield* MachineTemplates.Service
        const o = yield* InfraFixture.org
        const first = folder(o, { home: { name: "Home" } }, { Python: python })

        const created = yield* infra.plan(o.admin, first)
        expect(created).toMatchObject({
          changes: [change("create", "environment", "environments/Python")],
          problems: [],
        })
        yield* infra.apply(o.admin, { ...first, digest: created.digest })
        const made = (yield* listed(o.admin)).at(0)
        expect(made).toMatchObject({ name: "Python", provider: "test", config: { label: "python" } })
        expect(yield* infra.plan(o.admin, first)).toMatchObject({ changes: [], problems: [] })

        const second = yield* InfraFixture.current(
          o.admin,
          folder(
            o,
            { home: { name: "Home" } },
            { Python: { ...python, config: { label: "python3" }, sessionsPerEnvironment: 4 } },
          ),
        )
        const updated = yield* infra.plan(o.admin, second)
        expect(InfraFixture.withoutValues(updated.changes)).toEqual([
          change("update", "environment", "environments/Python", { fields: ["config", "sessionsPerEnvironment"] }),
        ])
        yield* infra.apply(o.admin, { ...second, digest: updated.digest })
        expect(yield* templates.get(o.admin, made?.id ?? "")).toMatchObject({
          config: { label: "python3" },
          sessionsPerEnvironment: 4,
        })

        const third = yield* InfraFixture.current(o.admin, folder(o, { home: { name: "Home" } }, {}))
        const archived = yield* infra.plan(o.admin, third)
        expect(archived.changes).toEqual([change("archive", "environment", "environments/Python")])
        yield* infra.apply(o.admin, { ...third, digest: archived.digest })
        expect(yield* listed(o.admin)).toEqual([])
      }),
  )

  it.live("apply creates a template before a space's hand names it, and moves the hand off before archiving it", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const remote = yield* InfraFixture.current(
        o.admin,
        folder(o, { home: { name: "Home", hand: { placement: "remote", environment: "Python" } } }, { Python: python }),
      )

      const planned = yield* infra.plan(o.admin, remote)
      expect(planned.problems).toEqual([])
      expect(InfraFixture.withoutValues(planned.changes)).toEqual([
        change("create", "environment", "environments/Python"),
        change("update", "space", "spaces/home", { fields: ["hand"] }),
      ])
      const applied = yield* infra.apply(o.admin, { ...remote, digest: planned.digest })
      const made = (yield* listed(o.admin)).at(0)
      expect(yield* hand(o.admin, o.home.id)).toMatchObject({
        placement: "remote",
        environmentTemplateId: made?.id ?? "",
      })
      expect(yield* infra.plan(o.admin, { ...remote, lock: applied.lock })).toMatchObject({ changes: [], problems: [] })

      const back = { ...folder(o, { home: { name: "Home" } }, {}), lock: applied.lock }
      const reverted = yield* infra.plan(o.admin, back)
      expect(InfraFixture.withoutValues(reverted.changes)).toEqual([
        change("update", "space", "spaces/home", { fields: ["hand"] }),
        change("archive", "environment", "environments/Python"),
      ])
      yield* infra.apply(o.admin, { ...back, digest: reverted.digest })
      expect(yield* hand(o.admin, o.home.id)).toEqual({ placement: "colocated" })
      expect(yield* listed(o.admin)).toEqual([])
    }),
  )

  it.live("a plan reports each part that apply would refuse: providers, configs and templates not built yet", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org

      const plan = yield* infra.plan(
        o.admin,
        folder(
          o,
          {
            home: {
              name: "Home",
              brain: { provider: "nope" },
              hand: { placement: "remote", environment: "Built" },
            },
          },
          {
            Built: { provider: "built", config: { label: "built" } },
            Empty: { provider: "test", config: { label: "" } },
            Ghost: { provider: "nope", config: {} },
          },
        ),
      )

      expect(plan.problems).toEqual([
        { path: "environments/Empty", message: expect.stringContaining("label") },
        { path: "environments/Ghost", message: "This deployment has no environment provider “nope”." },
        { path: "spaces/home/brain", message: "This deployment has no brain provider “nope”." },
        {
          path: "spaces/home/hand",
          message:
            "Environment template “Built” has no image until its first build is ready. Apply it without this change first, then apply again when it is built.",
        },
      ])
    }),
  )

  it.live("archiving a template that a space outside the spec uses is a plan problem", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const templates = yield* MachineTemplates.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const made = yield* templates.create(o.admin, {
        ...python,
        provider: MachineProvider.ID.make("test"),
        name: "Python",
      })
      const own = yield* InfraFixture.privateSpace(o, "own")
      yield* database.db
        .update(Database.Schema.space)
        .set({ hand_placement: "remote", environment_template_id: made.id })
        .where(eq(Database.Schema.space.id, own))
      const input = { ...(yield* InfraFixture.pulled(o.admin)), spec: InfraFixture.spec({ home: { name: "Home" } }) }

      const plan = yield* infra.plan(o.admin, input)

      expect(plan.changes).toEqual([change("archive", "environment", "environments/Python")])
      expect(plan.problems).toEqual([
        {
          path: "environments/Python",
          message:
            "Space “Team” uses this environment template, and the spec does not manage it. Pick another brain or hand for it in the app first.",
        },
      ])
    }),
  )

  it.live("a change in Ren to a template since the lock is changed, and a change on both sides is a conflict", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const declared = folder(o, { home: { name: "Home" } }, { Python: python })
      const created = yield* infra.plan(o.admin, declared)
      const applied = yield* infra.apply(o.admin, { ...declared, digest: created.digest })
      const made = (yield* listed(o.admin)).at(0)
      yield* templates.update(o.admin, made?.id ?? (yield* Effect.die(new Error("no template"))), {
        sessionsPerEnvironment: 3,
      })

      expect((yield* infra.plan(o.admin, { ...declared, lock: applied.lock })).changes).toEqual([
        change("update", "environment", "environments/Python", {
          status: "changed",
          fields: ["sessionsPerEnvironment"],
          values: [{ field: "sessionsPerEnvironment", ren: "3", folder: "2" }],
        }),
      ])
      const edited = {
        ...folder(o, { home: { name: "Home" } }, { Python: { ...python, config: { label: "python3" } } }),
        lock: applied.lock,
      }
      expect(InfraFixture.withoutValues((yield* infra.plan(o.admin, edited)).changes)).toEqual([
        change("update", "environment", "environments/Python", {
          status: "conflict",
          fields: ["config", "sessionsPerEnvironment"],
        }),
      ])
    }),
  )
})
