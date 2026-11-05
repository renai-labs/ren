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
          "Return the chat’s tasks, the pull requests and issues they link, and the chat’s channel threads. Ren reads each pull request’s state from GitHub on each call.",
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
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "link" }))
