export * as DriveFiles from "./drive-files.js"

import { HandApi } from "@ren/hand-api/hand-api"
import type { HandClient } from "@ren/hand-api/hand-client"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { ByteSize, Effect, Option, Schema } from "effect"
import { posix } from "node:path"

export class Refused extends Schema.TaggedError<Refused>()("DriveFiles.Refused", { message: Schema.String }) {}

export interface Attached {
  readonly file: SessionMessage.DriveFile
  readonly bytes: Option.Option<Uint8Array>
}

const readable = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/json"])

const read = (client: HandClient.Client, path: string, size: number) =>
  Effect.forEach(
    Array.from({ length: Math.ceil(size / HandApi.maxFileBytes) }, (_, part) => part * HandApi.maxFileBytes),
    (offset) =>
      client["files.read"]({ path, range: { offset, length: Math.min(HandApi.maxFileBytes, size - offset) } }),
  ).pipe(
    Effect.map((parts) =>
      parts.reduce((all, part, index) => {
        all.set(part.bytes, index * HandApi.maxFileBytes)
        return all
      }, new Uint8Array(size)),
    ),
  )

export const attach = Effect.fn("DriveFiles.attach")(function* (
  client: HandClient.Client,
  root: string,
  files: ReadonlyArray<Session.DriveFile>,
) {
  yield* Effect.forEach(
    new Set(files.map((file) => `${root}/${file.path.slice(0, file.path.lastIndexOf("/"))}`)),
    (folder) => client["drives.refresh"]({ path: folder }).pipe(Effect.ignore),
    { concurrency: 4, discard: true },
  )
  const failed = (file: Session.DriveFile) => (error: { readonly _tag: string; readonly message?: string }) =>
    new Refused({
      message:
        error._tag === "FileNotFoundError"
          ? `${file.name} is not in the space’s drive at ${file.path}`
          : `${file.name} could not be read from the space’s drive: ${error.message ?? error._tag}`,
    })
  const found = yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const info = yield* client["files.stat"]({ path: `${root}/${file.path}` }).pipe(Effect.mapError(failed(file)))
        if (info.type !== "file")
          return yield* new Refused({ message: `${file.name} is not a file in the space’s drive at ${file.path}` })
        const mime = Drive.typeOf(file.path)
        const size = info.sizeBytes
        const isInlined = size <= Session.inlineLimitOf(mime) && (mime.startsWith("text/") || readable.has(mime))
        return { source: file, file: { path: file.path, name: file.name, mime, size }, isInlined }
      }),
    { concurrency: 4 },
  )
  // oxlint-disable-next-line ren/no-comments -- As for files sent inline, a message's files come with their bytes up to Session.maxInlineBytes in all, in order; the rest come with their path only.
  const inlined = found.reduce(
    (sum, each) =>
      each.isInlined && sum.bytes + each.file.size <= Session.maxInlineBytes
        ? { bytes: sum.bytes + each.file.size, paths: new Set([...sum.paths, each.file.path]) }
        : sum,
    { bytes: 0, paths: new Set<string>() },
  ).paths
  return yield* Effect.forEach(
    found,
    (each) =>
      Effect.map(
        inlined.has(each.file.path)
          ? Effect.map(
              read(client, `${root}/${each.file.path}`, each.file.size).pipe(Effect.mapError(failed(each.source))),
              Option.some,
            )
          : Effect.succeed(Option.none<Uint8Array>()),
        (bytes): Attached => ({ file: each.file, bytes }),
      ),
    { concurrency: 4 },
  )
})

export const show = Effect.fn("DriveFiles.show")(function* (
  client: HandClient.Client,
  root: string,
  sessionId: string,
  source: string,
) {
  const name = source.slice(source.lastIndexOf("/") + 1)
  const path = `${Drive.outputsOf(sessionId)}/${name}`
  const target = `${root}/${path}`
  const reasons: Readonly<Record<string, string>> = {
    FileNotFoundError: `${source} does not exist`,
    WrongKindError: `${source} is not a file`,
  }
  const failed = (error: { readonly _tag: string; readonly message?: string }) =>
    new Refused({
      message: reasons[error._tag] ?? `${source} could not be put in the space’s drive: ${error.message ?? error._tag}`,
    })
  if (source !== target) yield* client["files.copy"]({ from: source, to: target }).pipe(Effect.mapError(failed))
  const info = yield* client["files.stat"]({ path: target }).pipe(Effect.mapError(failed))
  if (info.sizeBytes > Drive.maxFileBytes)
    return yield* new Refused({ message: `${name} is larger than the space’s drive takes (100 MiB)` })
  yield* client["drives.uploaded"]({ path: target }).pipe(
    Effect.mapError((error) => new Refused({ message: `${name} did not reach the space’s drive: ${error.message}` })),
  )
  return { path, name, mime: Drive.typeOf(path), size: info.sizeBytes } satisfies SessionMessage.DriveFile
})

export const maxPageBytes = 5 * 1024 * 1024

const localReference = (reference: string) => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|$)/iu.test(reference)) return ""
  const bare = reference.replace(/[?#].*$/u, "")
  try {
    return decodeURI(bare)
  } catch {
    return bare
  }
}

export const publishPage = Effect.fn("DriveFiles.publishPage")(function* (
  client: HandClient.Client,
  root: string,
  sessionId: string,
  source: string,
  title?: string,
) {
  const name = source.slice(source.lastIndexOf("/") + 1)
  if (!/\.html?$/iu.test(name)) return yield* new Refused({ message: `${name} is not an HTML file` })
  const tooLarge = (bytes: number) =>
    new Refused({ message: `Page is too large (${(bytes / 1024 / 1024).toFixed(1)} MB, limit 5 MB)` })
  const readText = Effect.fnUntraced(function* (path: string) {
    const unreadable = (error: { readonly _tag: string }) =>
      new Refused({
        message: error._tag === "FileNotFoundError" ? `${path} does not exist` : `${path} could not be read`,
      })
    const info = yield* client["files.stat"]({ path }).pipe(Effect.mapError(unreadable))
    if (info.sizeBytes > maxPageBytes) return yield* tooLarge(info.sizeBytes)
    return yield* read(client, path, info.sizeBytes).pipe(Effect.mapError(unreadable))
  })
  const folder = source.slice(0, source.lastIndexOf("/"))
  const dataUrl = (path: string, reference: string) =>
    Effect.map(
      readText(path),
      (bytes) => `data:${Drive.typeOf(reference)};base64,${Buffer.from(bytes).toString("base64")}`,
    )
  const replaceAll = (
    html: string,
    pattern: RegExp,
    replacement: (found: string, groups: Record<string, string>) => Effect.Effect<string, Refused> | undefined,
  ) =>
    Effect.map(
      Effect.forEach(
        new Set(html.match(pattern)),
        (found) => {
          const groups = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(found)?.groups ?? {}
          const next = replacement(found, groups)
          return next ? Effect.map(next, (text) => [found, text] as const) : Effect.succeed([found, found] as const)
        },
        { concurrency: 4 },
      ),
      (pairs) => {
        const replaced = new Map(pairs)
        return html.replace(pattern, (found) => replaced.get(found) ?? found)
      },
    )
  const text = (path: string) => Effect.map(readText(path), (bytes) => new TextDecoder().decode(bytes))
  const original = yield* text(source)
  const withImages = yield* replaceAll(
    original,
    /(?<before><(?:img|source|video|audio)\b[^>]*?\bsrc\s*=\s*)(?<quote>["'])(?<ref>[^"']+)\k<quote>/giu,
    (_found, groups) => {
      const local = localReference(groups.ref ?? "")
      return local
        ? Effect.map(
            dataUrl(posix.join(folder, local), local),
            (url) => `${groups.before}${groups.quote}${url}${groups.quote}`,
          )
        : undefined
    },
  )
  const withStyles = yield* replaceAll(withImages, /<link\b[^>]*>/giu, (found) => {
    const href = /\bhref\s*=\s*(["'])([^"']+)\1/iu.exec(found)?.at(2)
    const local = href && /\brel\s*=\s*["']?stylesheet/iu.test(found) ? localReference(href) : ""
    return local
      ? Effect.map(text(posix.join(folder, local)), (css) => `<style>${css.replaceAll("</style", "<\\/style")}</style>`)
      : undefined
  })
  const page = yield* replaceAll(
    withStyles,
    /<script\b(?<before>[^>]*?)\bsrc\s*=\s*(?<quote>["'])(?<ref>[^"']+)\k<quote>(?<after>[^>]*)>\s*<\/script>/giu,
    (_found, groups) => {
      const local = localReference(groups.ref ?? "")
      return local
        ? Effect.map(
            text(posix.join(folder, local)),
            (js) =>
              `<script${`${groups.before}${groups.after}`.trimEnd()}>${js.replaceAll("</script", "<\\/script")}</script>`,
          )
        : undefined
    },
  )
  const bytes = new TextEncoder().encode(page)
  if (bytes.length > maxPageBytes) return yield* tooLarge(bytes.length)
  const path = `${Drive.pagesOf(sessionId)}/${crypto.randomUUID()}.html`
  const target = `${root}/${path}`
  const failed = (error: { readonly message?: string }) =>
    new Refused({ message: `${name} did not reach the space’s drive: ${error.message ?? "write failed"}` })
  yield* client["files.mkdir"]({ path: `${root}/${Drive.pagesOf(sessionId)}` }).pipe(Effect.mapError(failed))
  yield* client["files.write"]({ path: target, bytes }).pipe(Effect.mapError(failed))
  yield* client["drives.uploaded"]({ path: target }).pipe(Effect.mapError(failed))
  return {
    path,
    title: title?.trim() || /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(page)?.at(1)?.trim() || name,
    bytes: bytes.length,
  }
})

export const note = (root: string, files: ReadonlyArray<SessionMessage.DriveFile>) =>
  [
    "The person attached these files. Each one is in the space’s drive, on the environment:",
    ...files.map(
      (file) =>
        `- ${file.name} (${file.mime}, ${ByteSize.format(ByteSize.bytes(file.size), { system: "decimal", precision: 1 })}) at ${root}/${file.path}`,
    ),
  ].join("\n")
