import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import type { Infra } from "@ren/schema/infra"
import { Effect, Option } from "effect"
import type { Actor } from "../src/actor.js"
import { ChannelMappings } from "../src/channel-mappings.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { Space } from "../src/space.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const ready = {
  id: "pull_request_ready",
  title: "Review ready pull requests",
  description: "A pull request that is ready for review.",
  defaultPrompt: "Review this pull request.",
}

const fake = (
  id: "github" | "slack",
  places: ReadonlyArray<ChannelProvider.Place>,
  triggers: ReadonlyArray<typeof ready>,
): ChannelProvider.Provider => ({
  id,
  triggers,
  verify: () => Effect.void,
  parse: () => Effect.succeed({ _tag: "Ignore", reason: "a test" }),
  fetchFile: () => Effect.fail(new ChannelProvider.FileUnavailable({ message: "No files in tests" })),
  context: () => Effect.succeedNone,
  linkOf: () => Option.none(),
  send: () => Effect.void,
  progress: () => Effect.void,
  email: () => Effect.succeedNone,
  installUrl: () => "https://provider.test/install",
  completeInstall: () => Effect.fail(new ChannelProvider.InstallFailed({ message: "No installs in tests" })),
  changedOnProvider: () => false,
  revoke: () => Effect.void,
  places: () => Effect.succeed(places),
  place: (_workspace, placeId) => Effect.succeed(Option.fromNullishOr(places.find((place) => place.id === placeId))),
  announce: () => Effect.void,
})

const repositories = [
  ...Array.from({ length: 120 }, (_, index) => ({
    id: String(1000 + index),
    name: `acme/aaa-${String(index).padStart(3, "0")}`,
    private: true,
    anyoneCanWrite: false,
  })),
  { id: "9001", name: "acme/Web", private: true, anyoneCanWrite: false },
]

const it = testEffect(
  InfraFixture.layer(
    ChannelProvider.layer(
      Effect.succeed([
        Option.some(fake("github", repositories, [ready])),
        Option.some(
          fake(
            "slack",
            [
              { id: "C07", name: "eng", private: false, anyoneCanWrite: false },
              { id: "C09", name: "sales", private: false, anyoneCanWrite: false },
            ],
            [],
          ),
        ),
      ]),
    ),
  ),
)

const install = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, provider: "github" | "slack") {
  const database = yield* Database.Service
  const id = ChannelInstall.ID.create()
  yield* database.db.insert(Database.Schema.channel_install).values({
    id,
    organization_id: organizationId,
    provider,
    workspace: `W${crypto.randomUUID()}`,
    name: "Acme",
  })
  return id
})

const input = (organization: string, spaces: Record<string, unknown>, bound: Record<string, unknown> = {}) => ({
  bindings: InfraFixture.bindings(organization, bound),
  spec: InfraFixture.spec(spaces),
})

const apply = Effect.fnUntraced(function* (actor: Actor.Info, planned: Infra.PlanInput) {
  const infra = yield* InfraSpecs.Service
  const plan = yield* infra.plan(actor, planned)
  expect(plan.problems).toEqual([])
  yield* infra.apply(actor, { spec: planned.spec, bindings: planned.bindings, digest: plan.digest })
  return plan
})

const mappings = Effect.fnUntraced(function* (actor: Actor.Info) {
  const channelMappings = yield* ChannelMappings.Service
  return (yield* channelMappings.list(actor, { page: 1, pageSize: 100 })).items
})

describe("InfraSpecs channels", () => {
  it.live("apply maps a GitHub repository by its name, replans with no changes, and pull writes it back", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      yield* install(o.organizationId, "github")
      const first = input(
        o.bindings.organization,
        {
          home: {
            name: "Home",
            agents: { triage: {} },
            channels: {
              web: { kind: "github", purpose: "The web app", agent: "triage", triggers: { pull_request_ready: {} } },
            },
          },
        },
        { home: { channels: { web: { kind: "github", repository: "ACME/web" } } } },
      )

      const plan = yield* apply(o.admin, first)

      expect(plan.changes).toEqual([
        InfraFixture.change("create", "agent", "spaces/home/agents/triage"),
        InfraFixture.change("create", "channel", "spaces/home/channels/web"),
      ])
      expect(yield* mappings(o.admin)).toMatchObject([
        {
          provider: "github",
          place: "9001",
          placeName: "acme/Web",
          space: { id: o.home.id },
          agent: { name: "triage" },
          fallback: true,
          triggers: [{ id: "pull_request_ready" }],
        },
      ])
      expect(yield* infra.plan(o.admin, first)).toMatchObject({ changes: [], problems: [] })

      const pulled = yield* infra.pull(o.admin)
      expect(pulled.spec.spaces["home"]?.channels).toEqual({
        "acme-web": {
          kind: "github",
          purpose: "GitHub acme/Web",
          agent: "triage",
          fallback: true,
          triggers: { pull_request_ready: {} },
        },
      })
      expect(pulled.bindings.spaces["home"]).toEqual({
        channels: { "acme-web": { kind: "github", repository: "acme/Web" } },
        profiles: {},
      })
      expect(yield* infra.plan(o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
      })
    }),
  )

  it.live("a changed agent or trigger updates the mapping, and moving the channel moves the mapping", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const o = yield* InfraFixture.org
      const eng = yield* spaces.create(o.admin, { name: "Eng", slug: "eng" })
      yield* install(o.organizationId, "github")
      const bound = { kind: "github", repository: "acme/web" }
      const channel = { kind: "github", purpose: "Web", agent: "triage", triggers: { pull_request_ready: {} } }
      yield* apply(
        o.admin,
        input(
          o.bindings.organization,
          { home: { name: "Home", agents: { triage: {} }, channels: { web: channel } }, eng: { name: "Eng" } },
          { home: { channels: { web: bound } } },
        ),
      )

      const updated = yield* apply(
        o.admin,
        input(
          o.bindings.organization,
          {
            home: {
              name: "Home",
              agents: { triage: {} },
              channels: { web: { kind: "github", purpose: "Web", fallback: false } },
            },
            eng: { name: "Eng" },
          },
          { home: { channels: { web: bound } } },
        ),
      )

      expect(updated.changes).toEqual([
        InfraFixture.change("update", "channel", "spaces/home/channels/web", {
          fields: ["agent", "fallback", "triggers"],
        }),
      ])
      expect(yield* mappings(o.admin)).toMatchObject([{ agent: null, fallback: false, triggers: [] }])

      const moved = yield* apply(
        o.admin,
        input(
          o.bindings.organization,
          {
            home: { name: "Home", agents: { triage: {} } },
            eng: { name: "Eng", channels: { site: { kind: "github", purpose: "Web" } } },
          },
          { eng: { channels: { site: bound } } },
        ),
      )

      expect(moved.changes).toEqual([
        InfraFixture.change("update", "channel", "spaces/eng/channels/site", {
          fields: ["space"],
          from: "spaces/home/channels/acme-web",
        }),
      ])
      expect(yield* mappings(o.admin)).toMatchObject([{ space: { id: eng.id }, fallback: false }])
    }),
  )

  it.live("an undeclared mapping in a shared space is removed, and one in a private space is left alone", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const channelMappings = yield* ChannelMappings.Service
      const database = yield* Database.Service
      const o = yield* InfraFixture.org
      const installId = yield* install(o.organizationId, "slack")
      yield* channelMappings.create(o.admin, { installId, place: "C07", spaceId: o.home.id })
      const own = yield* InfraFixture.privateSpace(o, "own")
      yield* database.db.insert(Database.Schema.channel_mapping).values({
        id: ChannelMapping.ID.create(),
        install_id: installId,
        place: "C09",
        place_name: "sales",
        space_id: own,
      })

      const removed = yield* apply(o.admin, input(o.bindings.organization, { home: { name: "Home" } }))

      expect(removed.changes).toEqual([InfraFixture.change("archive", "channel", "spaces/home/channels/eng")])
      expect((yield* mappings(o.admin)).map((mapping) => mapping.place)).toEqual(["C09"])

      const stolen = yield* infra.plan(
        o.admin,
        input(
          o.bindings.organization,
          { home: { name: "Home", channels: { sales: { kind: "slack", purpose: "Sales" } } } },
          { home: { channels: { sales: { kind: "slack", channelId: "C09" } } } },
        ),
      )

      expect(stolen).toMatchObject({
        changes: [],
        problems: [
          {
            path: "spaces/home/channels/sales",
            message: "This Slack place is mapped to a space that the spec does not manage. Unmap it there first.",
          },
        ],
      })
    }),
  )

  it.live("a channel without a matching binding or install, of another kind, or on a claimed place is a problem", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      yield* install(o.organizationId, "github")
      const web = { kind: "github", repository: "acme/web" }

      const plan = yield* infra.plan(
        o.admin,
        input(
          o.bindings.organization,
          {
            home: {
              name: "Home",
              channels: {
                unbound: { kind: "github", purpose: "Unbound" },
                mismatched: { kind: "github", purpose: "Mismatched" },
                chat: { kind: "slack", purpose: "Chat" },
                tickets: { kind: "linear", purpose: "Tickets" },
                first: { kind: "github", purpose: "First" },
                second: { kind: "github", purpose: "Second" },
              },
            },
          },
          {
            home: {
              channels: {
                mismatched: { kind: "slack", channelId: "C07" },
                chat: { kind: "slack", channelId: "C07" },
                first: web,
                second: { kind: "github", repository: "ACME/Web" },
                stray: web,
              },
            },
          },
        ),
      )

      expect(plan.changes).toEqual([])
      expect(plan.problems).toEqual([
        {
          path: "deploy.yaml/spaces/home/channels/mismatched",
          message: "deploy.yaml binds a Slack place, but channel “mismatched” is a GitHub channel.",
        },
        {
          path: "deploy.yaml/spaces/home/channels/stray",
          message: "spaces/home/channels.yaml declares no channel “stray”.",
        },
        {
          path: "deploy.yaml/spaces/home/channels/unbound",
          message: "Bind channel “unbound” to a GitHub place in deploy.yaml.",
        },
        { path: "spaces/home/channels/chat", message: "Install the Slack app in Ren first, then plan again." },
        {
          path: "spaces/home/channels/first",
          message: "spaces/home/channels/second maps the same GitHub place. Map each place once.",
        },
        {
          path: "spaces/home/channels/second",
          message: "spaces/home/channels/first maps the same GitHub place. Map each place once.",
        },
        { path: "spaces/home/channels/tickets", message: "Infra does not apply linear channels yet." },
      ])
    }),
  )
})
