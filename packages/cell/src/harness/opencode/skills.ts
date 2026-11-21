export * as OpenCodeSkills from "./skills.js"

import { AbsolutePath } from "@opencode/client/effect"
import { SkillFile } from "@opencode/core/config/plugin/skill-file"
import { Permission } from "@opencode/core/permission"
import type { Plugin } from "@opencode/plugin/effect"
import { Agent } from "@opencode/schema/agent"
import { Skill } from "@opencode/schema/skill"
import type { HandCopies } from "@ren/brain/hand/copies"
import type { SkillSource } from "@ren/brain/skill/source"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { Effect, Equal, Hash, Option, Ref, Schema, Struct } from "effect"
import type { GitSources } from "../../git-sources.js"
import type { OpenCodeCopies } from "./copies.js"

export interface Registration {
  readonly info: Skill.Info
  readonly identity: string
  readonly directory: string
  readonly files: Option.Option<HandCopies.Copy>
  readonly source?: SkillSource.Pointer
  readonly app?: { readonly slug: string; readonly name: string }
}

const encoder = new TextEncoder()

const decodeCall = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }))

const noEnvironment =
  "\n\nThis chat has no execution environment, so the files and scripts that this skill names are not available."

export const make = Effect.fnUntraced(function* (input: {
  readonly context: Pick<Plugin.Context, "skill" | "tool" | "session" | "agent" | "location">
  readonly isSession: boolean
  readonly hasWorkspace: boolean
  readonly sources: GitSources.Interface["skills"]
  readonly apps: Option.Option<AppCatalog.Info>
  readonly onPrompt: Effect.Effect<void>
}) {
  if (!input.isSession)
    return {
      prepare: () => Effect.succeed<ReadonlyArray<Registration>>([]),
      apply: () => Effect.void,
      isChanged: (): boolean => false,
      items: (): ReadonlyArray<OpenCodeCopies.Item> => [],
    }
  const root = `${input.context.location.directory}/.ren/skills`
  const current = yield* Ref.make<ReadonlyArray<Registration>>([])
  const entriesOf = (apps: Option.Option<AppCatalog.Info>) =>
    Option.match(apps, { onNone: () => [], onSome: (info) => info.catalog.skills })
  const hasWorkspace = input.hasWorkspace
  const prepare = Effect.fnUntraced(function* (apps: Option.Option<AppCatalog.Info>) {
    const previous = yield* Ref.get(current)
    const names = new Map(
      Option.match(apps, { onNone: () => [], onSome: (info) => info.catalog.apps }).map(
        (app) => [app.appSlug, app.name] as const,
      ),
    )
    const prepared = yield* Effect.forEach(
      entriesOf(apps),
      Effect.fnUntraced(function* (entry) {
        const declaration = entry.declaration
        const app = { slug: entry.appSlug, name: names.get(entry.appSlug) ?? entry.appSlug }
        if (declaration.type === "content") {
          // oxlint-disable-next-line ren/no-comments -- An app has one definition (profiles.md P2), so a content skill is named by its content: an edit gives a new directory.
          const identity = Math.abs(Hash.string(JSON.stringify(declaration))).toString(36)
          const directory = `${root}/${entry.slug}/${identity}`
          const hasFiles = Object.keys(declaration.files).length > 0
          return [
            {
              identity,
              directory,
              app,
              files: hasFiles
                ? Option.some({
                    type: "inline" as const,
                    files: [["SKILL.md", declaration.instructions] as const, ...Object.entries(declaration.files)].map(
                      (file) => ({ path: file.at(0) ?? "", bytes: encoder.encode(file.at(1) ?? "") }),
                    ),
                  })
                : Option.none(),
              info: {
                id: Skill.ID.make(entry.slug),
                name: Skill.Name.make(entry.slug),
                description: declaration.description,
                path: AbsolutePath.make(`${directory}/skill.md`),
                content: `${declaration.instructions}${hasFiles && !hasWorkspace ? noEnvironment : ""}`,
              },
            },
          ] satisfies ReadonlyArray<Registration>
        }
        const fallback = previous.filter(
          (registration) =>
            registration.info.id === entry.slug && Equal.equals(registration.source, declaration.upstream),
        )
        const found = yield* input.sources.cache.resolve(declaration.upstream).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(`The skill ${entry.slug} of the app ${entry.appSlug} is not available: ${error.message}`),
          ),
          Effect.option,
        )
        if (Option.isNone(found)) return fallback.map((registration) => ({ ...registration, app }))
        const read = SkillFile.parse(root, `${root}/${entry.slug}/SKILL.md`, found.value.document)
        if (read._tag === "Skipped") {
          yield* Effect.logWarning(`The SKILL.md of the skill ${entry.slug} has no valid ${read.reason}`)
          return fallback.map((registration) => ({ ...registration, app }))
        }
        const identity = found.value.lookup.commit.slice(0, 12)
        const directory = `${root}/${entry.slug}/${identity}`
        const registration: Registration = {
          identity,
          directory,
          app,
          source: declaration.upstream,
          files: Option.some({
            type: "archive",
            unpack: { ...found.value.lookup.archive, folder: declaration.upstream.path },
          }),
          info: Struct.evolve(read.skill, {
            id: () => Skill.ID.make(entry.slug),
            path: () => AbsolutePath.make(`${directory}/skill.md`),
            content: (text) => `${text}${hasWorkspace ? "" : noEnvironment}`,
          }),
        }
        return [registration]
      }),
      { concurrency: 8 },
    )
    return prepared.flat()
  })
  yield* Ref.set(current, yield* prepare(input.apps))
  const loaded = new Map<string, Registration>()
  const load = (id: string) => {
    const registration = Ref.getUnsafe(current).find((each) => each.info.id === id)
    if (registration) loaded.set(id, registration)
  }
  const shapeOf = (all: ReadonlyArray<Registration>) =>
    all.map((each) => [each.info, each.app?.slug, each.app?.name] as const)
  const isChanged = (next: ReadonlyArray<Registration>) => !Equal.equals(shapeOf(next), shapeOf(Ref.getUnsafe(current)))
  yield* input.context.skill.transform((editor) => {
    for (const registration of Ref.getUnsafe(current)) editor.add(registration.info)
  })
  yield* input.context.tool.hook("execute.after", (event) =>
    Effect.sync(() => {
      if (event.tool !== "skill" || event.status !== "completed") return
      Option.map(decodeCall(event.input), (call) => load(call.id))
    }),
  )
  yield* input.context.session.hook("prompt", (event) =>
    Effect.gen(function* () {
      yield* input.onPrompt
      const mentioned = event.prompt.skills ?? []
      if (mentioned.length === 0) return
      const session = yield* input.context.session.get({ sessionID: event.sessionID }).pipe(Effect.option)
      const agentID = Option.getOrUndefined(session)?.agent
      const agent = agentID
        ? yield* input.context.agent.get({ agentID: Agent.ID.make(agentID) }).pipe(Effect.option)
        : Option.none()
      const rules = Option.match(agent, { onNone: () => [], onSome: (found) => found.data.permissions })
      const denied = mentioned.filter((skill) => Permission.evaluate("skill", skill.id, rules).effect === "deny")
      if (denied.length > 0) {
        event.prompt.skills = mentioned.filter((skill) => !denied.includes(skill))
        event.prompt.text = `${event.prompt.text}\n\n[Ren did not load ${denied.map((skill) => `the skill ${skill.id}`).join(", ")}: it is not allowed in this chat.]`
      }
      for (const skill of event.prompt.skills ?? []) load(skill.id)
    }),
  )
  // oxlint-disable-next-line ren/no-comments -- The agent sees a mention as plain `@<app>` text, and OpenCode lists a skill only when it has a description and may load itself (no disable-model-invocation). Name each app's skills, and the ones that load only by name, so that the agent knows what it has.
  const notes = Effect.fnUntraced(function* (agentID: string, tools: Readonly<Record<string, unknown>>) {
    if (!("skill" in tools)) return []
    const all = Ref.getUnsafe(current)
    if (all.length === 0) return []
    const agent = yield* input.context.agent.get({ agentID: Agent.ID.make(agentID) }).pipe(Effect.option)
    const rules = Option.match(agent, { onNone: () => [], onSome: (found) => found.data.permissions })
    const allowed = all
      .filter((registration) => Permission.evaluate("skill", registration.info.id, rules).effect !== "deny")
      .toSorted((left, right) => left.info.id.localeCompare(right.info.id))
    const byApp = Map.groupBy(
      allowed.filter((registration) => registration.app !== undefined),
      (registration) => registration.app?.slug ?? "",
    )
    const apps = [...byApp.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([slug, registrations]) => {
        const name = registrations.at(0)?.app?.name ?? slug
        return `@${slug} (${name}) gives this chat the skills ${registrations.map((each) => each.info.id).join(", ")}.`
      })
    const named = allowed
      .filter((registration) => registration.info.autoinvoke === false || registration.info.description === undefined)
      .map((registration) =>
        registration.info.description
          ? `${registration.info.id} (${registration.info.description.replaceAll(/\s+/gu, " ").trim()})`
          : registration.info.id,
      )
    return [
      ...(apps.length > 0
        ? [
            `${apps.join(" ")} When someone mentions an app or asks what it has, these are its skills: load one with the skill tool.`,
          ]
        : []),
      ...(named.length > 0
        ? [
            `These skills are not in the list of available skills but this chat has them: ${named.join("; ")}. They load only when named: when the person asks for one, load it with the skill tool.`,
          ]
        : []),
    ]
  })
  yield* input.context.session.hook("context", (event) =>
    Effect.gen(function* () {
      for (const text of yield* notes(event.agent, event.tools)) event.system.push({ type: "text", text })
      const changed = [...loaded.values()].filter((registration) => {
        const now = Ref.getUnsafe(current).find((each) => each.info.id === registration.info.id)
        return now ? now.identity !== registration.identity : false
      })
      if (changed.length > 0)
        event.system.push({
          type: "text",
          text: `The skill ${changed.map((each) => each.info.id).join(", ")} changed after this chat loaded it. Load it again with the skill tool before you follow it.`,
        })
    }),
  )
  return {
    prepare,
    apply: Effect.fnUntraced(function* (next: ReadonlyArray<Registration>) {
      if (!isChanged(next)) return
      yield* Ref.set(current, next)
      yield* input.context.skill.reload()
    }),
    isChanged,
    // oxlint-disable-next-line ren/no-comments -- The files of each loaded skill, for the copy before an environment tool.
    items: (): ReadonlyArray<OpenCodeCopies.Item> =>
      hasWorkspace
        ? [...loaded.values()].flatMap((registration) =>
            Option.match(registration.files, {
              onNone: () => [],
              onSome: (copy) => [
                {
                  path: registration.directory,
                  copy,
                  note: (message: string) =>
                    `The files of the skill ${registration.info.id} are not on the environment: ${message}. The next environment tool copies them again.`,
                },
              ],
            }),
          )
        : [],
  }
})
