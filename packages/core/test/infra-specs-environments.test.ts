import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Infra } from "@ren/schema/infra"
import { MachineProvider } from "@ren/schema/machine-provider"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Actor } from "../src/actor.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { MachineTemplates } from "../src/machine-templates.js"
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

describe("InfraSpecs environments", () => {
  it.live("pull writes the org's environment templates, and its plan is empty", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const provider = MachineProvider.ID.make("test")
      yield* templates.create(o.admin, { ...python, provider, name: "Python", description: "Data work." })

      const pulled = yield* infra.pull(o.admin, {})

      expect(Schema.encodeSync(Infra.Pulled)(pulled).spec.environments).toEqual({
        Python: { ...python, description: "Data work." },
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

  it.live("a plan reports a template that apply would refuse: an unknown provider or a config it refuses", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org

      const plan = yield* infra.plan(
        o.admin,
        folder(
          o,
          { home: { name: "Home" } },
          {
            Empty: { provider: "test", config: { label: "" } },
            Ghost: { provider: "nope", config: {} },
          },
        ),
      )

      expect(plan.problems).toEqual([
        { path: "environments/Empty", message: expect.stringContaining("label") },
        { path: "environments/Ghost", message: "This deployment has no environment provider “nope”." },
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
