export * as LinkPreview from "./link-preview.js"

import { Schema } from "effect"
import { PullRequest } from "./pull-request.js"
import { TaskLink } from "./task-link.js"

export const maximumUrls = 20

export const Kind = Schema.Literals(["github_pr", "github_issue", "linear_issue", "notion_page"]).annotate({
  identifier: "LinkPreview.Kind",
})
export type Kind = typeof Kind.Type

export const Provider = Schema.Literals(["github", "linear", "notion"]).annotate({ identifier: "LinkPreview.Provider" })
export type Provider = typeof Provider.Type

export const providerOf = {
  github_pr: "github",
  github_issue: "github",
  linear_issue: "linear",
  notion_page: "notion",
} as const satisfies Record<Kind, Provider>

export const Reason = Schema.Literals(["not_connected", "no_access", "failed"]).annotate({
  identifier: "LinkPreview.Reason",
  description:
    "`not_connected`: Ren has no connection to read it. `no_access`: the connection cannot read it. `failed`: the service did not answer.",
})
export type Reason = typeof Reason.Type

export interface Person extends Schema.Schema.Type<typeof Person> {}
export const Person = Schema.Struct({
  name: Schema.String,
  avatarUrl: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "LinkPreview.Person" })

const item = {
  url: Schema.String,
  ref: Schema.String,
  title: Schema.String,
  people: Schema.Array(Person),
  updatedAt: Schema.DateTimeUtc,
}

export interface GitHubPullRequest extends Schema.Schema.Type<typeof GitHubPullRequest> {}
export const GitHubPullRequest = Schema.Struct({
  kind: Schema.Literal("github_pr"),
  ...item,
  state: PullRequest.State,
}).annotate({ identifier: "LinkPreview.GitHubPullRequest" })

export interface GitHubIssue extends Schema.Schema.Type<typeof GitHubIssue> {}
export const GitHubIssue = Schema.Struct({
  kind: Schema.Literal("github_issue"),
  ...item,
  state: Schema.Literals(["open", "closed"]),
}).annotate({ identifier: "LinkPreview.GitHubIssue" })

export interface LinearState extends Schema.Schema.Type<typeof LinearState> {}
export const LinearState = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["triage", "backlog", "unstarted", "started", "completed", "canceled"]),
  color: Schema.String,
}).annotate({ identifier: "LinkPreview.LinearState" })

export interface LinearIssue extends Schema.Schema.Type<typeof LinearIssue> {}
export const LinearIssue = Schema.Struct({
  kind: Schema.Literal("linear_issue"),
  ...item,
  state: LinearState,
}).annotate({ identifier: "LinkPreview.LinearIssue" })

export interface NotionIcon extends Schema.Schema.Type<typeof NotionIcon> {}
export const NotionIcon = Schema.Struct({
  type: Schema.Literals(["emoji", "image"]),
  value: Schema.String,
}).annotate({ identifier: "LinkPreview.NotionIcon" })

export interface NotionPage extends Schema.Schema.Type<typeof NotionPage> {}
export const NotionPage = Schema.Struct({
  kind: Schema.Literal("notion_page"),
  ...item,
  icon: Schema.optionalKey(NotionIcon),
}).annotate({ identifier: "LinkPreview.NotionPage" })

export interface Unavailable extends Schema.Schema.Type<typeof Unavailable> {}
export const Unavailable = Schema.Struct({
  kind: Schema.Literal("unavailable"),
  url: Schema.String,
  provider: Provider,
  reason: Reason,
  canConnect: Schema.Boolean.annotate({
    description: "True when the reader can connect the app in the chat’s space, so the card may offer it.",
  }),
}).annotate({ identifier: "LinkPreview.Unavailable" })

export const Info = Schema.Union([GitHubPullRequest, GitHubIssue, LinearIssue, NotionPage, Unavailable])
  .pipe(Schema.toTaggedUnion("kind"))
  .annotate({
    identifier: "LinkPreview.Info",
    description: "What the chat’s reader may see of one link. `url` is the link as the message wrote it.",
  })
export type Info = typeof Info.Type

export const Input = Schema.Struct({
  urls: Schema.Array(Schema.String.check(Schema.isMaxLength(TaskLink.maximumUrlLength))).check(
    Schema.isMaxLength(maximumUrls, { message: `Use ${maximumUrls} links or fewer.` }),
  ),
}).annotate({ identifier: "LinkPreview.Input" })

export interface Ref {
  readonly kind: Kind
  readonly key: string
  readonly ref: string
}

const notionPage =
  /^(?:[^/]+\/)*(?:[^/]*-)?(?<id>[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})\/?$/iu

const notionHost = /^(?:(?:www\.)?notion\.so|[^.]+\.notion\.site)$/u

export const classify = (value: string): Ref | undefined => {
  const url = URL.parse(value)
  if (!url || !["http:", "https:"].includes(url.protocol)) return
  const typed = TaskLink.classify(value)
  const split = typed.key.lastIndexOf("#")
  const path = url.pathname.split("/").filter(Boolean)
  if (typed.kind === "github_pr" || typed.kind === "github_issue")
    return { kind: typed.kind, key: typed.key, ref: `${path.at(0)}/${path.at(1)}#${typed.key.slice(split + 1)}` }
  if (typed.kind === "linear_issue") return { kind: typed.kind, key: typed.key, ref: typed.key.split("/").at(1) ?? "" }
  const id = notionHost.test(url.hostname.toLowerCase())
    ? notionPage.exec(path.join("/"))?.groups?.id?.replaceAll("-", "").toLowerCase()
    : undefined
  if (!id) return
  const dashed = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
  return { kind: "notion_page", key: dashed, ref: dashed }
}
