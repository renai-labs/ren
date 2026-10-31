import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { App } from "../src/app.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { Space } from "../src/space.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const skill = (instructions: string) => ({
  type: "content" as const,
  description: "Takes notes.",
  instructions,
})

const notes = (slug: string, more: Record<string, unknown> = {}) => ({
  [slug]: { name: "Notes", description: "Writes notes.", skills: { [`${slug}-write`]: skill("Write.") }, ...more },
})

const unique = () => `notes-${crypto.randomUUID().slice(0, 8)}`

describe("InfraSpecs apps", () => {
  it.live("apply creates, updates and archives the custom apps of a space, and pull writes them back", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const apps = yield* App.Service
      const o = yield* InfraFixture.org
      const slug = unique()
      const tools = unique()
      const input = (spaces: Record<string, unknown>) => ({ bindings: o.bindings, spec: InfraFixture.spec(spaces) })
      const first = input({ home: { name: "Home", apps: { ...notes(tools), ...notes(slug, { dependsOn: [tools] }) } } })

      const created = yield* infra.plan(o.admin, first)

      expect(created).toMatchObject({
        changes: [
          InfraFixture.change("create", "app", `spaces/home/apps/${tools}`),
          InfraFixture.change("create", "app", `spaces/home/apps/${slug}`),
        ],
        problems: [],
      })
      yield* infra.apply(o.admin, { ...first, digest: created.digest })
      expect((yield* apps.get(o.admin, slug)).dependsOn).toEqual([tools])
      expect(yield* infra.plan(o.admin, first)).toMatchObject({ changes: [], problems: [] })

      const second = input({
        home: {
          name: "Home",
          apps: notes(slug, {
            description: "Writes better notes.",
            skills: { [`${slug}-write`]: skill("Write well.") },
          }),
        },
      })
      const locked = yield* InfraFixture.current(o.admin, second)
      const updated = yield* infra.plan(o.admin, locked)

      expect(InfraFixture.withoutValues(updated.changes)).toEqual([
        InfraFixture.change("update", "app", `spaces/home/apps/${slug}`, { fields: ["metadata", "definition"] }),
        InfraFixture.change("archive", "app", `spaces/home/apps/${tools}`),
      ])
      yield* infra.apply(o.admin, { ...locked, digest: updated.digest })
      const written = yield* apps.get(o.admin, slug)
      expect(written).toMatchObject({ description: "Writes better notes.", revision: 2, dependsOn: [] })
      expect((yield* apps.get(o.admin, tools).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")

      const pulled = yield* infra.pull(o.admin, {})
      expect(pulled.spec.spaces["home"]?.apps).toEqual({
        [slug]: {
          name: "Notes",
          description: "Writes better notes.",
          requiredCredentials: [],
          skills: { [`${slug}-write`]: { ...skill("Write well."), requiredCredentials: [], files: {} } },
          mcps: {},
          dependsOn: [],
        },
      })
      expect(yield* infra.plan(o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
      })
    }),
  )

  it.live("moving an app's folder to another space transfers it", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const apps = yield* App.Service
      const spaces = yield* Space.Service
      const o = yield* InfraFixture.org
      const eng = yield* spaces.create(o.admin, { name: "Eng", slug: "eng" })
      const slug = unique()
      const before = {
        bindings: o.bindings,
        spec: InfraFixture.spec({ home: { name: "Home", apps: notes(slug) }, eng: { name: "Eng" } }),
      }
      yield* infra.apply(o.admin, { ...before, digest: (yield* infra.plan(o.admin, before)).digest })
      const after = {
        bindings: o.bindings,
        spec: InfraFixture.spec({ home: { name: "Home" }, eng: { name: "Eng", apps: notes(slug) } }),
      }

      const moved = yield* InfraFixture.current(o.admin, after)
      const plan = yield* infra.plan(o.admin, moved)

      expect(InfraFixture.withoutValues(plan.changes)).toEqual([
        InfraFixture.change("update", "app", `spaces/eng/apps/${slug}`, {
          fields: ["owner"],
          from: `spaces/home/apps/${slug}`,
        }),
      ])
      yield* infra.apply(o.admin, { ...moved, digest: plan.digest })
      expect((yield* apps.get(o.admin, slug)).ownerSpaceId).toBe(eng.id)
    }),
  )

  it.live("a slug that another app holds, or a rename, is a problem", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const other = yield* InfraFixture.org
      const slug = unique()
      const theirs = {
        bindings: other.bindings,
        spec: InfraFixture.spec({ home: { name: "Home", apps: notes(slug) } }),
      }
      yield* infra.apply(other.admin, { ...theirs, digest: (yield* infra.plan(other.admin, theirs)).digest })

      const plan = yield* infra.plan(o.admin, {
        bindings: o.bindings,
        spec: InfraFixture.spec({ home: { name: "Home", apps: notes(slug, { renamedFrom: ["older"] }) } }),
      })

      expect(plan.problems).toEqual([
        {
          path: `spaces/home/apps/${slug}`,
          message: `App slug “${slug}” is taken by another app. Choose another slug.`,
        },
        {
          path: `spaces/home/apps/${slug}`,
          message: "Infra does not rename apps yet. Remove renamedFrom.",
        },
      ])
    }),
  )
})
