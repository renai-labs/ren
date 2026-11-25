export * as InfraEnvironments from "./environments.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { MachineTemplate } from "@ren/schema/machine-template"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { Effect, Equal, Option, Predicate } from "effect"
import { HandProvider } from "../hand-provider.js"
import type { MachineProvider } from "../machine-provider.js"
import { MachineTemplates } from "../machine-templates.js"
import { InfraPlan } from "./plan.js"

export interface LiveTemplate {
  readonly id: MachineTemplate.ID
  readonly name: string
  readonly declaration: MachineTemplate.Declaration
  readonly buildStatus: MachineTemplate.BuildStatus
  readonly image: string | null
}

export interface Live {
  readonly templates: ReadonlyArray<LiveTemplate>
  readonly running: ReadonlyArray<{ readonly spaceId: Space.ID; readonly templateId: string }>
  readonly invalid: ReadonlyMap<string, string>
}

export interface KeptSpace {
  readonly id: Space.ID
  readonly name: string
  readonly uses: ReadonlyArray<MachineTemplate.ID>
}

export const path = (name: string) => `environments/${name}`

export const canonical = (declaration: MachineTemplate.Declaration) => ({
  ...(Predicate.isString(declaration.description) && { description: declaration.description }),
  provider: declaration.provider,
  config: declaration.config,
  sessionsPerEnvironment: declaration.sessionsPerEnvironment,
  networking: declaration.networking,
})

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  registry: MachineProvider.Registry,
  declared: Readonly<Record<string, MachineTemplate.Declaration>>,
) {
  const table = Database.Schema.environment_template
  const brain = Database.Schema.brain
  const chats = Database.Schema.session_environment
  const applied = sql<string>`${brain.image_template}->>'environmentTemplateId'`
  const rows = yield* transaction
    .select()
    .from(table)
    .where(and(eq(table.organization_id, organizationId), isNull(table.archived_at)))
    .orderBy(asc(table.created_at), asc(table.id))
  const brains = yield* transaction
    .selectDistinct({ spaceId: brain.space_id, templateId: applied })
    .from(brain)
    .where(and(eq(brain.organization_id, organizationId), isNotNull(applied)))
  const sessions = yield* transaction
    .selectDistinct({ spaceId: chats.space_id, templateId: chats.environment_template_id })
    .from(chats)
    .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, chats.space_id))
    .where(eq(Database.Schema.space.organization_id, organizationId))
  const invalid = yield* Effect.forEach(Object.entries(declared), ([name, declaration]) =>
    Option.match(registry.get(declaration.provider), {
      onNone: () => Effect.succeed([]),
      onSome: (provider) =>
        provider.check(declaration.config).pipe(
          Effect.as([]),
          Effect.catch((error) => Effect.succeed([[name, error.message] as const])),
        ),
    }),
  )
  return {
    templates: rows.map((row) => ({
      id: row.id,
      name: row.name,
      declaration: {
        ...(Predicate.isNotNull(row.description) && { description: row.description }),
        provider: row.provider,
        config: row.config,
        sessionsPerEnvironment: row.sessions_per_environment,
        networking: row.networking,
      },
      buildStatus: row.build_status,
      image: row.image,
    })),
    running: [...brains, ...sessions],
    invalid: new Map(invalid.flat()),
  } satisfies Live
})

export const make = Effect.gen(function* () {
  const templates = yield* MachineTemplates.Service
  const registry = yield* HandProvider.Registry

  const diff = (
    context: InfraPlan.Context,
    live: Live,
    declared: Readonly<Record<string, MachineTemplate.Declaration>>,
    kept: ReadonlyArray<KeptSpace>,
  ) => {
    const byName = Map.groupBy(live.templates, (template) => template.name)
    const entries = Object.entries(declared).map(([name, declaration]) => ({
      name,
      declaration,
      current: byName.get(name)?.at(0),
      provider: registry.get(declaration.provider),
    }))
    const problems = entries.flatMap((entry): Array<{ readonly path: string; readonly message: string }> => {
      const at = path(entry.name)
      const invalid = live.invalid.get(entry.name)
      return [
        ...((byName.get(entry.name)?.length ?? 0) > 1
          ? [
              {
                path: at,
                message: `More than one live environment template is named “${entry.name}”. Rename or archive the others in the app.`,
              },
            ]
          : []),
        ...(Option.isNone(entry.provider)
          ? [{ path: at, message: `This deployment has no environment provider “${entry.declaration.provider}”.` }]
          : []),
        ...(entry.declaration.networking.type === "limited" &&
        Option.exists(entry.provider, (provider) => !provider.info.canLimitHosts)
          ? [
              {
                path: at,
                message: `${entry.declaration.provider} machines cannot keep to a list of hosts; use unrestricted networking.`,
              },
            ]
          : []),
        ...(invalid ? [{ path: at, message: invalid }] : []),
        ...(entry.current && entry.current.declaration.provider !== entry.declaration.provider
          ? [
              {
                path: at,
                message: "An environment template cannot change its provider. Give the new one another name.",
              },
            ]
          : []),
      ]
    })

    const writes = entries.flatMap((entry): Array<InfraPlan.Step> => {
      const at = path(entry.name)
      const declaration = entry.declaration
      const current = entry.current
      if (!current)
        return [
          InfraPlan.step(
            "create",
            "environment",
            at,
            templates.create(context.actor, {
              name: entry.name,
              description: declaration.description,
              provider: declaration.provider,
              config: declaration.config,
              sessionsPerEnvironment: declaration.sessionsPerEnvironment,
              networking: declaration.networking,
            }),
          ),
        ]
      if (current.declaration.provider !== declaration.provider) return []
      const fields = InfraPlan.changed({
        description: (current.declaration.description ?? null) !== (declaration.description ?? null),
        config: !Equal.equals(current.declaration.config, declaration.config),
        sessionsPerEnvironment: current.declaration.sessionsPerEnvironment !== declaration.sessionsPerEnvironment,
        networking: !Equal.equals(current.declaration.networking, declaration.networking),
      })
      if (fields.length === 0) return []
      return [
        InfraPlan.step(
          "update",
          "environment",
          at,
          templates.update(context.actor, current.id, {
            ...(fields.includes("description") && { description: declaration.description ?? null }),
            ...(fields.includes("config") && { config: declaration.config }),
            ...(fields.includes("sessionsPerEnvironment") && {
              sessionsPerEnvironment: declaration.sessionsPerEnvironment,
            }),
            ...(fields.includes("networking") && { networking: declaration.networking }),
          }),
          { fields },
        ),
      ]
    })

    const archived = live.templates.filter((template) => !(template.name in declared))
    const archives = archived.map((template) =>
      InfraPlan.step("archive", "environment", path(template.name), templates.archive(context.actor, template.id)),
    )
    const keptById = new Map(kept.map((space) => [space.id, space]))
    const inUse = [
      ...archived.flatMap((template) =>
        kept
          .filter((space) => space.uses.includes(template.id))
          .map((space) => ({
            path: path(template.name),
            message: `Space “${space.name}” uses this environment template, and the spec does not manage it. Pick another brain or hand for it in the app first.`,
          })),
      ),
      ...archived.flatMap((template) =>
        live.running
          .filter((running) => running.templateId === template.id)
          .flatMap((running) => keptById.get(running.spaceId) ?? [])
          .map((space) => ({
            path: path(template.name),
            message: `Space “${space.name}” still runs brains or chats on this environment template. Shut the space down in the app, then plan again.`,
          })),
      ),
    ]

    return {
      steps: writes.toSorted(InfraPlan.byPath),
      removals: archives.toSorted(InfraPlan.byPath),
      problems: [...problems, ...inUse],
    }
  }

  const pull = (live: Live): Record<string, MachineTemplate.Declaration> =>
    Object.fromEntries(
      [...Map.groupBy(live.templates, (template) => template.name)].flatMap(([name, rows]) =>
        rows.slice(0, 1).map((template) => [name, template.declaration] as const),
      ),
    )

  return { diff, pull }
})
