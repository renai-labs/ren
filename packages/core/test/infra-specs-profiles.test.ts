import { describe, expect } from "bun:test"
import { AppProfile } from "@ren/schema/app-profile"
import type { Infra } from "@ren/schema/infra"
import { Effect, Schema } from "effect"
import type { Actor } from "../src/actor.js"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { Space } from "../src/space.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const unique = () => `notes-${crypto.randomUUID().slice(0, 8)}`

const notes = (slug: string) => ({
  [slug]: {
    name: "Notes",
    description: "Writes notes.",
    skills: { [`${slug}-write`]: { type: "content", description: "Takes notes.", instructions: "Write." } },
  },
})

const input = (organization: string, spaces: Record<string, unknown>, bound: Record<string, unknown> = {}) => ({
  bindings: InfraFixture.bindings(organization, bound),
  spec: InfraFixture.spec(spaces),
})

const apply = Effect.fnUntraced(function* (actor: Actor.Info, planned: Infra.PlanInput) {
  const infra = yield* InfraSpecs.Service
  const input = yield* InfraFixture.current(actor, planned)
  const plan = yield* infra.plan(actor, input)
  expect(plan.problems).toEqual([])
  yield* infra.apply(actor, { ...input, digest: plan.digest })
  return { changes: InfraFixture.withoutValues(plan.changes) }
})

const setup = Effect.gen(function* () {
  const apps = yield* App.Service
  const profiles = yield* AppProfiles.Service
  const spaces = yield* Space.Service
  const o = yield* InfraFixture.org
  const eng = yield* spaces.create(o.admin, { name: "Eng", slug: "eng" })
  const slug = unique()
  const declared = { home: { name: "Home", apps: notes(slug) }, eng: { name: "Eng" } }
  yield* apply(o.admin, input(o.bindings.organization, declared))
  const team = yield* profiles.create(o.admin, {
    appId: (yield* apps.get(o.admin, slug)).id,
    name: "Team",
    slug: Schema.decodeUnknownSync(AppProfile.Slug)("team"),
    kind: "shared",
    spaceIds: [o.home.id],
  })
  return { o, eng, slug, declared, team }
})

const listed = Effect.fnUntraced(function* (actor: Actor.Info, id: AppProfile.ID) {
  const profiles = yield* AppProfiles.Service
  return (yield* profiles.get(actor, id)).spaces.map((space) => space.name).toSorted()
})

describe("InfraSpecs profiles", () => {
  it.live("listing a profile adds the space, replans with no changes, and pull writes it back", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      const wanted = input(s.o.bindings.organization, s.declared, { eng: { profiles: { [s.slug]: ["team"] } } })

      const plan = yield* apply(s.o.admin, wanted)

      expect(plan.changes).toEqual([
        InfraFixture.change("create", "profile", `deploy.yaml/spaces/eng/profiles/${s.slug}/team`),
      ])
      expect(yield* listed(s.o.admin, s.team.id)).toEqual(["Eng", "Home"])
      expect(yield* infra.plan(s.o.admin, wanted)).toMatchObject({ changes: [], problems: [] })

      const pulled = yield* infra.pull(s.o.admin, {})
      expect(pulled.bindings.spaces).toEqual({
        home: { channels: {}, profiles: { [s.slug]: ["home", "team"] } },
        eng: { channels: {}, profiles: { [s.slug]: ["team"] } },
      })
      expect(yield* infra.plan(s.o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
      })
    }),
  )

  it.live("unlisting removes a space that another space keeps listed, and refuses to delete the profile", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      yield* apply(
        s.o.admin,
        input(s.o.bindings.organization, s.declared, { eng: { profiles: { [s.slug]: ["team"] } } }),
      )

      const removed = yield* apply(
        s.o.admin,
        input(s.o.bindings.organization, s.declared, { eng: { profiles: { [s.slug]: [] } } }),
      )

      expect(removed.changes).toEqual([
        InfraFixture.change("archive", "profile", `deploy.yaml/spaces/eng/profiles/${s.slug}/team`),
      ])
      expect(yield* listed(s.o.admin, s.team.id)).toEqual(["Home"])

      const last = yield* infra.plan(
        s.o.admin,
        input(s.o.bindings.organization, s.declared, { home: { profiles: { [s.slug]: ["home"] } } }),
      )

      expect(last).toMatchObject({
        changes: [],
        problems: [
          {
            path: `deploy.yaml/spaces/home/profiles/${s.slug}/team`,
            message: `No other space lists profile team of ${s.slug}, so removing it would delete the profile and its credentials. Infra never deletes a profile: keep it listed, or delete it in the app.`,
          },
        ],
      })
      const profiles = yield* AppProfiles.Service
      expect((yield* profiles.unlist(s.o.admin, s.team.id, [s.o.home.id]).pipe(Effect.flip))._tag).toBe(
        "Primitive.Conflict",
      )
      expect(yield* listed(s.o.admin, s.team.id)).toEqual(["Home"])
    }),
  )

  it.live("a profile that does not exist is a problem: infra lists profiles, it never makes them", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const s = yield* setup
      const fresh = unique()
      const spaces = { home: { name: "Home", apps: { ...notes(s.slug), ...notes(fresh) } }, eng: { name: "Eng" } }

      const plan = yield* infra.plan(
        s.o.admin,
        input(s.o.bindings.organization, spaces, {
          home: { profiles: { [fresh]: ["home"], [s.slug]: ["home", "team"] } },
          eng: { profiles: { [s.slug]: ["nope"] } },
        }),
      )

      expect(plan.problems).toEqual([
        {
          path: `deploy.yaml/spaces/eng/profiles/${s.slug}/nope`,
          message: `Create the shared profile nope of ${s.slug} in Ren first.`,
        },
        {
          path: `deploy.yaml/spaces/home/profiles/${fresh}/home`,
          message: `Create the shared profile home of ${fresh} in Ren first.`,
        },
      ])
    }),
  )
})
