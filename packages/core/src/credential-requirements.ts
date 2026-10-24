export * as CredentialRequirements from "./credential-requirements.js"

import { Database } from "@ren/db/database"
import type { App } from "@ren/schema/app"
import { Credential } from "@ren/schema/credential"
import type { Mcp } from "@ren/schema/mcp"
import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import type { Actor } from "./actor.js"
import { AppQueries } from "./app/queries.js"
import { EgressControl } from "./egress-control.js"
import { McpProvider } from "./mcp-provider.js"
import { OAuth } from "./oauth.js"
import { Primitive } from "./primitive.js"

export interface Interface {
  readonly forApp: (
    actor: Actor.Info,
    input: Credential.RequirementsInput,
  ) => Effect.Effect<Credential.Requirements, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialRequirements") {}

const table = Database.Schema.credential

type Row = typeof table.$inferSelect

interface Need {
  readonly group: App.ID
  readonly app: App.ID
  readonly mcp: string | null
  readonly label: string
  readonly name: string
  readonly kind: Credential.RequirementKind
  readonly declaration: Option.Option<Mcp.Declaration>
}

// oxlint-disable-next-line ren/no-comments -- §10a rule 1 (K33): one item per MCP that needs a credential, sorted by slug, then one per env key of the app.
const needsOf = (group: App.ID, release: typeof Database.Schema.app_release.$inferSelect): ReadonlyArray<Need> => [
  ...Object.entries(release.mcps)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([mcp, declaration]): ReadonlyArray<Need> => {
      const kind: Credential.RequirementKind | undefined =
        declaration.transport.type === "provider"
          ? "provider"
          : { none: undefined, oauth: "oauth" as const, header: "fields" as const, basic: "fields" as const }[
              declaration.auth.type
            ]
      return kind
        ? [
            {
              group,
              app: release.app_id,
              mcp,
              label: OAuth.labelOf(mcp),
              name: declaration.name,
              kind,
              declaration: Option.some(declaration),
            },
          ]
        : []
    }),
  ...release.required_credentials.flatMap((requirement): ReadonlyArray<Need> =>
    requirement.kind === "env"
      ? [
          {
            group,
            app: release.app_id,
            mcp: null,
            label: requirement.name,
            name: requirement.name,
            kind: "env",
            declaration: Option.none(),
          },
        ]
      : [],
  ),
]

const expectedType: Readonly<Record<Credential.RequirementKind, Credential.Type | undefined>> = {
  oauth: "oauth",
  provider: "route",
  fields: "fields",
  env: undefined,
}

// oxlint-disable-next-line ren/no-comments -- §10a rule 7 (K36): a credential made for another declaration needs a reconnect in this space only: another type, a host it does not allow, or scopes it lacks.
const outdated = (need: Need, row: Row) => {
  const expected = expectedType[need.kind]
  if (expected && row.type !== expected) return true
  return Option.exists(need.declaration, (declaration) => {
    const transport = declaration.transport
    const host = transport.type === "remote" ? URL.parse(transport.url)?.hostname : undefined
    if (host && !row.hosts.some((pattern) => Credential.matchesHost(pattern, host))) return true
    const scopes = declaration.auth.type === "oauth" ? (declaration.auth.scopes ?? []) : []
    return scopes.some((scope) => !row.scopes.includes(scope))
  })
}

const order: ReadonlyArray<Row["owner"]> = ["person", "space", "org"]

// oxlint-disable-next-line ren/no-comments -- owner-access §10 and connections.md §10a/§10b: the items of an app in the release the space uses, then its dependencies' items (K35). An MCP item counts only a credential with its app and MCP and no connection name (K34, K38); the lookup order is person (on a session brain), space, org. A Composio account that is not ACTIVE gets status reconnect (K28).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const providers = yield* McpProvider.Service
    const control = yield* EgressControl.Service

    const health = Effect.fnUntraced(function* (row: Row) {
      if (row.type !== "route" || !row.provider_account_id || row.status !== "ok") return row.status
      const provider = yield* Effect.option(providers.get("composio"))
      if (Option.isNone(provider)) return row.status
      const status = yield* Effect.option(provider.value.status(row.provider_account_id))
      if (Option.isNone(status) || status.value === "ACTIVE") return row.status
      yield* database.db.update(table).set({ status: "reconnect" }).where(eq(table.id, row.id)).pipe(Effect.orDie)
      yield* control.invalidate({ label: row.label })
      return "reconnect" as const
    })

    return Service.of({
      forApp: Effect.fn("CredentialRequirements.forApp")(function* (
        actor: Actor.Info,
        input: Credential.RequirementsInput,
      ) {
        const space = (yield* database.db
          .select({ id: Database.Schema.space.id, scope: Database.Schema.space.brain_scope })
          .from(Database.Schema.space)
          .where(
            and(
              eq(Database.Schema.space.id, input.spaceId),
              eq(Database.Schema.space.organization_id, actor.organizationId),
              isNull(Database.Schema.space.archived_at),
            ),
          )
          .pipe(Effect.orDie)).at(0)
        if (!space) return yield* new Primitive.NotFound({ message: "Space not found." })
        const entries = yield* AppQueries.inSpace(database.db, input.spaceId).pipe(Effect.orDie)
        const root = entries.find((entry) => entry.app.id === input.appId)
        if (!root) return yield* new Primitive.NotFound({ message: "App not found in this space." })
        const dependencies = yield* database.db
          .select({ appId: Database.Schema.app_release_dependency.dependency_app_id })
          .from(Database.Schema.app_release_dependency)
          .where(eq(Database.Schema.app_release_dependency.app_release_id, root.release.id))
          .pipe(Effect.orDie)
        const groups = [
          root,
          ...dependencies.flatMap((dependency) => entries.filter((entry) => entry.app.id === dependency.appId)),
        ]
        const needs = groups.flatMap((entry) => needsOf(entry.app.id, entry.release))
        const personal = space.scope === "session"
        const rows = yield* database.db
          .select()
          .from(table)
          .where(
            and(
              eq(table.organization_id, actor.organizationId),
              inArray(table.label, [...new Set(needs.map((need) => need.label))]),
              or(
                eq(table.owner, "org"),
                and(eq(table.owner, "space"), eq(table.space_id, input.spaceId)),
                personal ? and(eq(table.owner, "person"), eq(table.user_id, actor.userId)) : undefined,
              ),
            ),
          )
          .pipe(Effect.orDie)
        const ordered = rows.toSorted((left, right) => order.indexOf(left.owner) - order.indexOf(right.owner))
        const items = yield* Effect.forEach(needs, (need) =>
          Effect.gen(function* () {
            const row = ordered.find(
              (candidate) =>
                candidate.label === need.label &&
                (need.mcp === null ||
                  (candidate.app_id === need.app && candidate.mcp === need.mcp && candidate.connection === null)),
            )
            const status = yield* Effect.suspend(() => {
              if (!row) return Effect.succeed("missing" as const)
              if (outdated(need, row)) return Effect.succeed("reconnect" as const)
              return health(row)
            })
            return {
              key: `${need.app}:${need.mcp ?? need.label}`,
              group: need.group,
              app: need.app,
              mcp: need.mcp,
              label: need.label,
              name: need.name,
              kind: need.kind,
              status,
              credentialId: row?.id ?? null,
              destinations: personal ? ["person", "space", "org"] : ["space", "org"],
            } satisfies Credential.RequirementItem
          }),
        )
        return { items }
      }),
    })
  }),
)
