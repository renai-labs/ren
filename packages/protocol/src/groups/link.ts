import { LinkPreview } from "@ren/schema/link-preview"
import { PullRequest } from "@ren/schema/pull-request"
import { Session } from "@ren/schema/session"
import { SessionLinks } from "@ren/schema/session/links"
import { Task } from "@ren/schema/task"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const LinkGroup = HttpApiGroup.make("link")
  .add(
    HttpApiEndpoint.get("session.links", "/sessions/:id/links", {
      params: { id: Session.ID },
      success: SessionLinks.Info,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.links",
        summary: "List a chat’s links",
        description:
          "Return the chat’s tasks, the pull requests and issues they link, and the chat’s channel threads, as Ren stores them. A subagent’s chat reads through its root chat.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.pullRequests", "/sessions/:id/pull-requests", {
      params: { id: Session.ID },
      success: Schema.Array(PullRequest.Info),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.pullRequests",
        summary: "List a chat’s pull requests",
        description:
          "Return the pull requests of `session.links` with their title and state from GitHub. Ren reads GitHub on each call.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("task.pullRequests", "/tasks/:id/pull-requests", {
      params: { id: Task.ID },
      success: Schema.Array(PullRequest.Info),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "task.pullRequests",
        summary: "List a task’s pull requests",
        description:
          "Return the pull requests the task links, in link order, with their title and state from GitHub. Ren reads GitHub on each call.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.linkPreviews", "/sessions/:id/link-previews", {
      params: { id: Session.ID },
      payload: LinkPreview.Input,
      success: Schema.Array(LinkPreview.Info),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.linkPreviews",
        summary: "Preview the links of a chat’s message",
        description:
          "Return a preview for each GitHub pull request, GitHub issue, Linear issue and Notion page among up to 20 links of one finished message. Other links are left out. A preview shows only what the chat could read for the caller: GitHub through the organization’s GitHub App, for the space’s repositories; Linear and Notion through an app profile the space reaches that is shared or the caller’s own. A link Ren cannot read is `unavailable` with its reason. Ren stores no preview and caches each for 60 seconds.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "link" }))
