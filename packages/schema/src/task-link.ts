export * as TaskLink from "./task-link.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"

export const ID = Identifier.make("tlk", "TaskLink.ID")
export type ID = typeof ID.Type

export const Kind = Schema.Literals(["github_pr", "linear_issue", "slack_thread", "url"]).annotate({
  identifier: "TaskLink.Kind",
})
export type Kind = typeof Kind.Type

export const maximumUrlLength = 2048

const isUrl = (value: string) =>
  value.startsWith("/") ? !value.startsWith("//") && !value.startsWith("/\\") : URL.canParse(value)

export const Url = Schema.String.check(
  Schema.isMaxLength(maximumUrlLength, { message: `Use ${maximumUrlLength} characters or fewer.` }),
  Schema.makeFilter((value) => isUrl(value) || "Use an absolute URL or a path that starts with a single /."),
).annotate({ identifier: "TaskLink.Url" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  kind: Kind,
  url: Schema.String,
}).annotate({ identifier: "TaskLink.Info" })

export interface Ref {
  readonly kind: Kind
  readonly key: string
}

const matchers: ReadonlyArray<(url: URL, path: string) => Ref | undefined> = [
  (_, path) => {
    const pull = /^github\.com\/(?<repository>[^/]+\/[^/]+)\/pull\/(?<number>\d+)(?:\/|$)/u.exec(path)?.groups
    return pull && { kind: "github_pr", key: `${pull.repository?.toLowerCase()}#${Number(pull.number)}` }
  },
  (_, path) => {
    const issue = /^linear\.app\/(?<workspace>[^/]+)\/issue\/(?<key>[^/]+)/u.exec(path)?.groups
    return issue && { kind: "linear_issue", key: `${issue.workspace?.toLowerCase()}/${issue.key?.toUpperCase()}` }
  },
  (url, path) => {
    const archive = /^[^/]+\.slack\.com\/archives\/(?<channel>[^/]+)\/(?<message>[^/]+)/u.exec(path)?.groups
    const param = url.searchParams.get("thread_ts")
    const permalink = /^p(?<seconds>\d{10})(?<micros>\d{6})$/u.exec(archive?.message ?? "")?.groups
    const thread = param && /^\d+\.\d+$/u.test(param) ? param : permalink && `${permalink.seconds}.${permalink.micros}`
    return archive && thread ? { kind: "slack_thread", key: `${archive.channel?.toUpperCase()}:${thread}` } : undefined
  },
]

export const classify = (value: string): Ref => {
  const url = URL.parse(value)
  const typed =
    url && ["http:", "https:"].includes(url.protocol)
      ? matchers.map((match) => match(url, `${url.hostname.toLowerCase()}${url.pathname}`)).find(Boolean)
      : undefined
  return typed ?? { kind: "url", key: value }
}
