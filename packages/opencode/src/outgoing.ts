export * as Outgoing from "./outgoing.js"

import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Space } from "@ren/schema/space"
import { Effect, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, Mime } from "effect/http"
import { RenApi } from "./ren.js"

interface Mention {
  readonly start: number
  readonly end: number
  readonly text: string
}

export interface Local {
  readonly text: string
  readonly files?:
    | ReadonlyArray<{
        readonly data: string
        readonly mime: string
        readonly name?: string | undefined
        readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
      }>
    | undefined
  readonly agents?: ReadonlyArray<{ readonly name: string; readonly mention?: Mention | undefined }> | undefined
  readonly skills?:
    | ReadonlyArray<{
        readonly id: string
        readonly name: string
        readonly text?: string | undefined
        readonly mention?: Mention | undefined
      }>
    | undefined
}

export interface Prompt {
  readonly id: SessionMessage.ID
  readonly text: string
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly name: string
    readonly bytes: Uint8Array<ArrayBuffer>
  }>
  readonly agents: ReadonlyArray<SessionMessage.AgentAttachment>
  readonly skills: ReadonlyArray<{ readonly id: string; readonly mention?: Mention }>
}

export class Refused extends Schema.TaggedError<Refused>()("Outgoing.Refused", { message: Schema.String }) {}

const extension = /(\.[^.]*)?$/u

const nameOf = (file: NonNullable<Local["files"]>[number]) => {
  const base =
    (file.name ?? (file.source.type === "uri" ? decodeURIComponent(new URL(file.source.uri).pathname) : ""))
      .split("/")
      .at(-1)
      ?.replaceAll(/\p{Cc}/gu, "")
      .trim() || "Pasted file"
  if (file.mime === "application/x-directory") return `${base}.listing.txt`
  const typed = Drive.typeOf(base)
  if (file.mime === "text/plain")
    return typed.startsWith("text/") || typed === "application/json" ? base : `${base}.txt`
  return typed === file.mime
    ? base
    : Option.match(Mime.getExtension(file.mime), {
        onNone: () => base,
        onSome: (suffix) => `${base}.${suffix}`,
      })
}

const byKey = <A extends { readonly id: string; readonly name: string }>(items: ReadonlyArray<A>) => ({
  id: new Map(items.map((item) => [item.id, item])),
  name: new Map(items.map((item) => [item.name, item])),
})

export const prepare = Effect.fn("Outgoing.prepare")(function* <E>(
  catalog: Effect.Effect<
    { readonly agents: ReadonlyArray<SessionCatalog.Agent>; readonly skills: ReadonlyArray<SessionCatalog.Skill> },
    E
  >,
  sessionID: Session.ID,
  messages: ReadonlyArray<{ readonly id: SessionMessage.ID; readonly local: Local }>,
): Effect.fn.Return<ReadonlyArray<Prompt>, Refused | E> {
  const brain = messages.some(
    (message) => (message.local.agents?.length ?? 0) + (message.local.skills?.length ?? 0) > 0,
  )
    ? yield* catalog
    : { agents: [], skills: [] }
  const agents = byKey(brain.agents)
  const remoteSkills = byKey(brain.skills)
  return yield* Effect.forEach(messages, (message) => {
    const local = message.local
    const skills = (local.skills ?? []).map((skill) => ({
      skill,
      remote: remoteSkills.id.get(skill.id) ?? remoteSkills.name.get(skill.name),
    }))
    const named = [
      ...(local.files ?? []).map((file) => ({ name: nameOf(file), bytes: Buffer.from(file.data, "base64") })),
      ...skills.flatMap((each) =>
        each.remote || !each.skill.text
          ? []
          : [{ name: `${each.skill.name}.skill.md`, bytes: Buffer.from(each.skill.text) }],
      ),
    ]
    if (named.length > Session.maxDriveFiles)
      return Effect.fail(
        new Refused({
          message: `This message attaches ${named.length} files, and Ren takes at most ${Session.maxDriveFiles} in one message. Send it again with fewer files.`,
        }),
      )
    const folder = Drive.uploadsOf(sessionID, message.id)
    const taken = new Set<string>()
    const files = named.map((file) => {
      const suffix = extension.exec(file.name)?.at(0) ?? ""
      const stem = file.name.slice(0, file.name.length - suffix.length)
      const name =
        Array.from({ length: taken.size + 1 }, (_, index) =>
          index === 0 ? file.name : `${stem} (${index + 1})${suffix}`,
        ).find((candidate) => !taken.has(candidate)) ?? file.name
      taken.add(name)
      return { path: `${folder}/${name}`, name, bytes: file.bytes }
    })
    return Effect.succeed<Prompt>({
      id: message.id,
      text: local.text,
      files,
      agents: (local.agents ?? []).flatMap((agent) => {
        const remote = agents.id.get(agent.name) ?? agents.name.get(agent.name)
        return remote ? [{ name: remote.id, ...(agent.mention && { mention: agent.mention }) }] : []
      }),
      skills: skills.flatMap((each) =>
        each.remote ? [{ id: each.remote.id, ...(each.skill.mention && { mention: each.skill.mention }) }] : [],
      ),
    })
  })
})

export const upload = Effect.fn("Outgoing.upload")(function* (spaceId: Space.ID, prompt: Prompt) {
  if (prompt.files.length > 0) {
    const ren = yield* RenApi.Service
    const client = yield* ren.client.pipe(Effect.mapError((error) => new Refused({ message: error.message })))
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    yield* Effect.forEach(
      prompt.files,
      (file) =>
        client.drive.startUpload({ spaceId, path: file.path, size: file.bytes.byteLength }).pipe(
          Effect.flatMap((form) => {
            const body = new FormData()
            for (const entry of Object.entries(form.fields)) body.append(...entry)
            body.append("file", new Blob([file.bytes]), file.name)
            return http.execute(HttpClientRequest.post(form.uploadUrl).pipe(HttpClientRequest.bodyFormData(body)))
          }),
          Effect.mapError(
            (error) =>
              new Refused({
                message: `Ren did not take ${file.name}: ${error.message.replace(/\.$/u, "")}. Send the message again without it.`,
              }),
          ),
        ),
      { concurrency: 4, discard: true },
    )
  }
  return {
    id: prompt.id,
    text: prompt.text,
    ...(prompt.files.length > 0 && { files: prompt.files.map((file) => ({ path: file.path, name: file.name })) }),
    ...(prompt.agents.length > 0 && { agents: prompt.agents }),
    ...(prompt.skills.length > 0 && { skills: prompt.skills }),
  }
}, Effect.provide(FetchHttpClient.layer))
