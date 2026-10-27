import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { GitHubApp } from "../src/github-app.js"
import { Primitive } from "../src/primitive.js"
import { ReferenceCheck } from "../src/reference-check.js"
import { RepositoryHosts } from "../src/repository-hosts.js"
import { Space } from "../src/space.js"
import { SpaceSettings } from "../src/space/settings.js"
import { testEffect } from "./lib/effect.js"
import { GitHubServer } from "./lib/github-server.js"
import { Seed } from "./lib/seed.js"

const github = GitHubServer.start()
afterAll(() => github.stop())

const it = testEffect(
  Layer.mergeAll(SpaceSettings.layer, Space.layer).pipe(
    Layer.provideMerge(ReferenceCheck.layer),
    Layer.provideMerge(RepositoryHosts.layer),
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone, GitHubApp.layer)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown(GitHubServer.config(github.url, { GITHUB_URL: "https://github.com" })),
      ),
    ),
  ),
)

const installGitHub = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  const database = yield* Database.Service
  const workspace = String(Math.floor(Math.random() * 1e9))
  github.installations.set(workspace, "acme")
  yield* database.db.insert(Database.Schema.channel_install).values({
    id: ChannelInstall.ID.create(),
    organization_id: organizationId,
    provider: "github",
    workspace,
    name: "acme",
  })
})

const reference = (repository: string) => ({
  alias: repository.split("/").at(-1) ?? "",
  repository,
  description: "Docs",
})

const settings = { instructions: "We use Bun.", permissions: [], references: [] }

describe("SpaceSettings", () => {
  it.live("space members edit space settings; other members, admins included (AC4), get NotFound", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const space = yield* SpaceSettings.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Seed.actor(organizationId, "member")
      const grace = yield* Seed.actor(organizationId, "member")
      const admin = yield* Seed.actor(organizationId, "admin")
      const team = yield* spaces.create(ada, { name: "Team" })
      expect((yield* space.update(ada, team.id, { settings })).settings).toEqual(settings)
      expect((yield* Effect.flip(space.get(admin, team.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(space.get(grace, team.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(space.update(grace, team.id, { settings })))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("a space with no row reads as empty settings", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const space = yield* SpaceSettings.Service
      const ada = yield* Seed.actor(yield* Seed.organization(), "member")
      const team = yield* spaces.create(ada, { name: "Team" })
      expect(yield* space.get(ada, team.id)).toMatchObject({
        settings: { permissions: [], references: [] },
        updatedAt: null,
      })
    }),
  )

  it.live(
    "a new reference that the installation cannot read, or on another host than GITHUB_URL, is refused; one GitHub does not answer for is saved (R13, R26)",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const space = yield* SpaceSettings.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* Seed.actor(organizationId, "member")
        const team = yield* spaces.create(ada, { name: "Team" })
        yield* installGitHub(organizationId)
        github.resources.set("/repos/acme/docs", { full_name: "acme/docs" })
        const save = (repositories: ReadonlyArray<string>) =>
          space.update(ada, team.id, { settings: { ...settings, references: repositories.map(reference) } })
        expect(yield* save(["https://github.com/acme/docs"])).toMatchObject({
          settings: { references: [reference("https://github.com/acme/docs")] },
        })
        expect(yield* Effect.flip(save(["https://github.com/acme/docs", "https://github.com/acme/secret"]))).toEqual(
          new Primitive.Invalid({
            message:
              "the GitHub App cannot read acme/secret: add the repository to the installation, or acme/secret does not exist",
            field: "references.secret",
          }),
        )
        expect(yield* Effect.flip(save(["https://gitlab.com/acme/docs"]))).toMatchObject({
          message: "Ren reads only repositories on github.com, not https://gitlab.com/acme/docs",
          field: "references.docs",
        })
        expect(yield* Effect.flip(save(["https://github.com/acme/docs/tree/main"]))).toMatchObject({
          message:
            "https://github.com/acme/docs/tree/main is not the address of a repository: use https://github.com/<owner>/<repo>",
        })
        github.options.unavailable = true
        const saved = yield* save(["https://github.com/acme/docs", "https://github.com/acme/secret"]).pipe(
          Effect.ensuring(Effect.sync(() => (github.options.unavailable = false))),
        )
        expect(saved.settings.references.map((each) => each.alias)).toEqual(["docs", "secret"])
      }),
  )

  it.live("lists the repositories of the org's GitHub installation, and none without one", () =>
    Effect.gen(function* () {
      const hosts = yield* RepositoryHosts.Service
      const organizationId = yield* Seed.organization()
      expect(yield* hosts.list(organizationId)).toEqual([{ kind: "github", installed: false, repositories: [] }])
      yield* installGitHub(organizationId)
      github.repositories.push(
        {
          id: 1,
          full_name: "acme/docs",
          private: false,
          description: "Docs",
          html_url: "https://github.com/acme/docs",
        },
        { id: 2, full_name: "acme/api", private: true, description: null, html_url: "https://github.com/acme/api" },
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => github.repositories.splice(0)))
      expect(yield* hosts.list(organizationId)).toEqual([
        {
          kind: "github",
          installed: true,
          repositories: [
            { kind: "github", url: "https://github.com/acme/docs", name: "acme/docs", description: "Docs" },
            { kind: "github", url: "https://github.com/acme/api", name: "acme/api" },
          ],
        },
      ])
    }),
  )
})
