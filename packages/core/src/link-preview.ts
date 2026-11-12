export * as LinkPreview from "./link-preview.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import { LinkPreview } from "@ren/schema/link-preview"
import type { Session as SessionSchema } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { and, eq, inArray, or } from "drizzle-orm"
import { Cache, Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { Actor } from "./actor.js"
import { AppProfiles } from "./app/profiles.js"
import { Credentials } from "./credentials.js"
import { GitHubApp } from "./github-app.js"
import type { Primitive } from "./primitive.js"
import { Pull, stateOf } from "./pull-request.js"
import { Session } from "./session.js"
import { SettingsRows } from "./settings/rows.js"

export interface Interface {
  readonly read: (
    actor: Actor.Info,
    id: SessionSchema.ID,
    urls: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<LinkPreview.Info>, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/LinkPreview") {}

const timeLimit = "10 seconds"

const concurrency = 4

const hosts = { linear: "api.linear.app", notion: "api.notion.com" } as const

const GitHubPull = Schema.Struct({
  ...Pull.fields,
  user: Schema.NullOr(Schema.Struct({ login: Schema.String, avatar_url: Schema.optionalKey(Schema.String) })),
  updated_at: Schema.DateTimeUtcFromString,
})

const GitHubIssue = Schema.Struct({
  title: Schema.String,
  state: Schema.String,
  user: GitHubPull.fields.user,
  updated_at: Schema.DateTimeUtcFromString,
})

const LinearPerson = Schema.NullOr(Schema.Struct({ name: Schema.String, avatarUrl: Schema.NullOr(Schema.String) }))

const LinearAnswer = Schema.Struct({
  data: Schema.NullOr(
    Schema.Struct({
      issue: Schema.NullOr(
        Schema.Struct({
          identifier: Schema.String,
          url: Schema.String,
          title: Schema.String,
          updatedAt: Schema.DateTimeUtcFromString,
          assignee: LinearPerson,
          creator: LinearPerson,
          state: LinkPreview.LinearState,
        }),
      ),
    }),
  ),
})

const linearQuery = `query Issue($id: String!) { issue(id: $id) { identifier url title updatedAt assignee { name avatarUrl } creator { name avatarUrl } state { name type color } } }`

const NotionPageAnswer = Schema.Struct({
  last_edited_time: Schema.DateTimeUtcFromString,
  icon: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        type: Schema.String,
        emoji: Schema.optionalKey(Schema.String),
        external: Schema.optionalKey(Schema.Struct({ url: Schema.String })),
      }),
    ),
  ),
  properties: Schema.Record(
    Schema.String,
    Schema.Struct({
      type: Schema.String,
      title: Schema.optionalKey(Schema.Array(Schema.Struct({ plain_text: Schema.String }))),
    }),
  ),
})

const Key = Schema.fromJsonString(
  Schema.Struct({
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
    userId: Auth.UserID,
    url: Schema.String,
  }),
)

class Refused extends Schema.TaggedError<Refused>()("LinkPreview.Refused", {
  reason: LinkPreview.Reason,
}) {}

const refused = (reason: LinkPreview.Reason) => new Refused({ reason })

const person = (found: { readonly name: string; readonly avatarUrl: string | null } | null) =>
  found ? [{ name: found.name, ...(found.avatarUrl && { avatarUrl: found.avatarUrl }) }] : []

const tokenOf = (value: Credentials.Sealed) =>
  value.type === "oauth" || value.type === "client_credentials" ? value.accessToken : undefined

const iconOf = (icon: typeof NotionPageAnswer.Type.icon): LinkPreview.NotionIcon | undefined => {
  if (icon?.emoji) return { type: "emoji", value: icon.emoji }
  return icon?.external ? { type: "image", value: icon.external.url } : undefined
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const sessions = yield* Session.Service
    const github = yield* GitHubApp.Service
    const credentials = yield* Credentials.Service
    const http = yield* HttpClient.HttpClient
    const linearUrl = yield* Config.String("LINEAR_API_URL").pipe(Config.withDefault("https://api.linear.app"))
    const notionUrl = yield* Config.String("NOTION_API_URL").pipe(Config.withDefault("https://api.notion.com"))

    // oxlint-disable-next-line ren/no-comments -- The repositories the chat's brain can read: the references of the organization's and the space's settings.
    const repositories = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, spaceId: Space.ID) {
      const rows = yield* database.db
        .select()
        .from(Database.Schema.settings)
        .where(
          or(
            eq(Database.Schema.settings.organization_id, organizationId),
            eq(Database.Schema.settings.space_id, spaceId),
          ),
        )
        .pipe(Effect.orDie)
      const decoded = yield* Effect.forEach(rows, SettingsRows.decode)
      return new Set(
        decoded.flatMap((row) =>
          row.settings.references.flatMap((reference) => {
            const url = URL.parse(reference.repository)
            const path = url?.pathname.split("/").filter(Boolean)
            return url?.hostname === "github.com" && path && path.length >= 2
              ? [`${path.at(0)}/${path.at(1)?.replace(/\.git$/u, "")}`.toLowerCase()]
              : []
          }),
        ),
      )
    })

    // oxlint-disable-next-line ren/no-comments -- A profile that the space reaches and that is shared, or is the reader's own private one. Another member's private profile is never used. The reader's own private profile comes first.
    const connection = Effect.fnUntraced(function* (
      provider: "linear" | "notion",
      key: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID; readonly userId: Auth.UserID },
    ) {
      const reached = yield* AppProfiles.reachable(database.db, {
        organizationId: key.organizationId,
        spaceId: Option.some(key.spaceId),
      }).pipe(Effect.orDie)
      const owners = reached.length
        ? yield* database.db
            .select({ id: Database.Schema.app_profile.id, userId: Database.Schema.app_profile.user_id })
            .from(Database.Schema.app_profile)
            .where(
              inArray(
                Database.Schema.app_profile.id,
                reached.map((profile) => profile.id),
              ),
            )
            .pipe(Effect.orDie)
        : []
      const ownerOf = new Map(owners.map((owner) => [owner.id, owner.userId]))
      const own = (profile: (typeof reached)[number]) => ownerOf.get(profile.id) === key.userId
      const usable = reached
        .filter((profile) => profile.kind === "shared" || own(profile))
        .toSorted((left, right) => Number(own(right)) - Number(own(left)))
      const rows = usable.length
        ? yield* database.db
            .select({
              id: Database.Schema.credential.id,
              profileId: Database.Schema.credential.profile_id,
              hosts: Database.Schema.credential.hosts,
              inject: Database.Schema.credential.inject,
            })
            .from(Database.Schema.credential)
            .where(
              and(
                eq(Database.Schema.credential.owner, "profile"),
                eq(Database.Schema.credential.status, "ok"),
                inArray(
                  Database.Schema.credential.profile_id,
                  usable.map((profile) => profile.id),
                ),
              ),
            )
            .pipe(Effect.orDie)
        : []
      const row = usable
        .flatMap((profile) => rows.filter((each) => each.profileId === profile.id))
        .find((each) => each.hosts.some((pattern) => Credential.matchesHost(pattern, hosts[provider])))
      const canConnect = usable.some((profile) => profile.appSlug === provider)
      if (!row) return { canConnect, header: Option.none<Redacted.Redacted>() }
      const opened = yield* credentials.open(row.id)
      const header = Option.flatMap(opened, (found) => {
        const secret = found.value.type === "key" ? found.value.value : tokenOf(found.value)
        const isRaw =
          provider === "linear" &&
          found.value.type === "key" &&
          !(row.inject.op === "setHeader" && row.inject.format.startsWith("Bearer"))
        return Option.fromNullishOr(secret).pipe(
          Option.map((each) => (isRaw ? each : Redacted.make(`Bearer ${Redacted.value(each)}`))),
        )
      })
      return { canConnect, header }
    })

    const send = <S extends Schema.Decoder<unknown>>(schema: S, request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const response = yield* http.execute(request).pipe(Effect.timeout(timeLimit))
        if (response.status === 401 || response.status === 403 || response.status === 404)
          return yield* refused("no_access")
        if (response.status >= 300) return yield* refused("failed")
        return yield* HttpClientResponse.schemaBodyJson(schema)(response)
      }).pipe(
        Effect.catch((error) =>
          error instanceof Refused
            ? Effect.fail(error)
            : Effect.logDebug("A link preview failed", error).pipe(Effect.andThen(Effect.fail(refused("failed")))),
        ),
      )

    const gitHub = Effect.fnUntraced(function* (
      key: Schema.Schema.Type<typeof Key>,
      ref: LinkPreview.Ref & { readonly kind: "github_pr" | "github_issue" },
    ) {
      const split = ref.key.lastIndexOf("#")
      const repository = ref.key.slice(0, split)
      const number = ref.key.slice(split + 1)
      if (!(yield* repositories(key.organizationId, key.spaceId)).has(repository)) return yield* refused("no_access")
      const installed = yield* github.installationOf(key.organizationId)
      if (Option.isNone(installed)) return yield* refused("not_connected")
      const path = `/repos/${repository.split("/").map(encodeURIComponent).join("/")}/${ref.kind === "github_pr" ? "pulls" : "issues"}/${number}`
      const read = <S extends Schema.Top>(schema: S) =>
        installed.value.client
          .read(installed.value.installation, path, schema)
          .pipe(
            Effect.catchTag("GitHubApp.Failed", (error) =>
              Effect.logDebug("GitHub did not show a link", error).pipe(
                Effect.andThen(
                  Effect.fail(refused(error.status === 404 || error.status === 403 ? "no_access" : "failed")),
                ),
              ),
            ),
          )
      const shared = (found: {
        readonly title: string
        readonly user: typeof GitHubPull.Type.user
        readonly updated_at: typeof GitHubPull.Type.updated_at
      }) => ({
        url: key.url,
        ref: ref.ref,
        title: found.title,
        people: found.user
          ? [{ name: found.user.login, ...(found.user.avatar_url && { avatarUrl: found.user.avatar_url }) }]
          : [],
        updatedAt: found.updated_at,
      })
      if (ref.kind === "github_pr") {
        const found = yield* read(GitHubPull)
        return { kind: "github_pr", ...shared(found), state: stateOf(found) } satisfies LinkPreview.Info
      }
      const found = yield* read(GitHubIssue)
      return {
        kind: "github_issue",
        ...shared(found),
        state: found.state === "open" ? "open" : "closed",
      } satisfies LinkPreview.Info
    })

    const linear = Effect.fnUntraced(function* (key: Schema.Schema.Type<typeof Key>, ref: LinkPreview.Ref) {
      const found = yield* connection("linear", key)
      if (Option.isNone(found.header)) return yield* refused("not_connected")
      const request = HttpClientRequest.post(`${linearUrl.replace(/\/$/u, "")}/graphql`).pipe(
        HttpClientRequest.setHeader("authorization", Redacted.value(found.header.value)),
        HttpClientRequest.bodyJsonUnsafe({ query: linearQuery, variables: { id: ref.ref } }),
      )
      const issue = (yield* send(LinearAnswer, request)).data?.issue
      if (!issue) return yield* refused("no_access")
      const workspace = (url: string) => URL.parse(url)?.pathname.split("/").at(1)?.toLowerCase()
      if (workspace(issue.url) !== ref.key.split("/").at(0)?.toLowerCase()) return yield* refused("no_access")
      return {
        kind: "linear_issue",
        url: key.url,
        ref: issue.identifier,
        title: issue.title,
        people: person(issue.assignee ?? issue.creator),
        updatedAt: issue.updatedAt,
        state: issue.state,
      } satisfies LinkPreview.Info
    })

    const notion = Effect.fnUntraced(function* (key: Schema.Schema.Type<typeof Key>, ref: LinkPreview.Ref) {
      const found = yield* connection("notion", key)
      if (Option.isNone(found.header)) return yield* refused("not_connected")
      const request = HttpClientRequest.get(`${notionUrl.replace(/\/$/u, "")}/v1/pages/${ref.key}`).pipe(
        HttpClientRequest.setHeaders({
          authorization: Redacted.value(found.header.value),
          "notion-version": "2022-06-28",
        }),
      )
      const page = yield* send(NotionPageAnswer, request)
      const title =
        Object.values(page.properties)
          .find((property) => property.type === "title")
          ?.title?.map((part) => part.plain_text)
          .join("") || "Untitled"
      const icon = iconOf(page.icon)
      return {
        kind: "notion_page",
        url: key.url,
        ref: title,
        title,
        people: [],
        updatedAt: page.last_edited_time,
        ...(icon && { icon }),
      } satisfies LinkPreview.Info
    })

    const previews = yield* Cache.makeWith(
      (encoded: string) =>
        Effect.gen(function* () {
          const key = Schema.decodeSync(Key)(encoded)
          const ref = LinkPreview.classify(key.url)
          if (!ref) return Option.none<LinkPreview.Info>()
          const provider = LinkPreview.providerOf[ref.kind]
          const result: Effect.Effect<LinkPreview.Info, Refused> = {
            github_pr: () => gitHub(key, { ...ref, kind: "github_pr" }),
            github_issue: () => gitHub(key, { ...ref, kind: "github_issue" }),
            linear_issue: () => linear(key, ref),
            notion_page: () => notion(key, ref),
          }[ref.kind]()
          return Option.some(
            yield* result.pipe(
              Effect.catchTag("LinkPreview.Refused", (error) =>
                provider === "github" || error.reason !== "not_connected"
                  ? Effect.succeed<LinkPreview.Info>({
                      kind: "unavailable",
                      url: key.url,
                      provider,
                      reason: error.reason,
                      canConnect: false,
                    })
                  : Effect.map(connection(provider, key), (found): LinkPreview.Info => ({
                      kind: "unavailable",
                      url: key.url,
                      provider,
                      reason: "not_connected",
                      canConnect: found.canConnect,
                    })),
              ),
            ),
          )
        }),
      { capacity: 10_000, timeToLive: () => Duration.seconds(60) },
    )

    return Service.of({
      read: Effect.fn("LinkPreview.read")(function* (actor, id, urls) {
        const session = yield* sessions.get(actor, id)
        const wanted = [...new Set(urls)].slice(0, LinkPreview.maximumUrls)
        const found = yield* Effect.forEach(
          wanted,
          (url) =>
            Cache.get(
              previews,
              Schema.encodeSync(Key)({
                organizationId: actor.organizationId,
                spaceId: session.spaceId,
                userId: actor.userId,
                url,
              }),
            ),
          { concurrency },
        )
        return found.flatMap((preview) => (Option.isSome(preview) ? [preview.value] : []))
      }),
    })
  }),
)
