export * as SessionLinks from "./links.js"

import { Schema } from "effect"
import { Channel } from "../channel.js"
import { Task } from "../task.js"

export interface LinkedTask extends Schema.Schema.Type<typeof LinkedTask> {}
export const LinkedTask = Schema.Struct({
  id: Task.ID,
  identifier: Schema.String,
  title: Schema.String,
  status: Task.Status,
}).annotate({ identifier: "SessionLinks.LinkedTask" })

export interface LinkedPullRequest extends Schema.Schema.Type<typeof LinkedPullRequest> {}
export const LinkedPullRequest = Schema.Struct({
  url: Schema.String,
  number: Schema.Int,
}).annotate({
  identifier: "SessionLinks.LinkedPullRequest",
  description: "A pull request as Ren stores it. `session.pullRequests` adds its title and state from GitHub.",
})

export interface Issue extends Schema.Schema.Type<typeof Issue> {}
export const Issue = Schema.Struct({
  kind: Schema.Literals(["github_issue", "linear_issue"]),
  url: Schema.String,
}).annotate({ identifier: "SessionLinks.Issue" })

export interface Thread extends Schema.Schema.Type<typeof Thread> {}
export const Thread = Schema.Struct({
  provider: Channel.Provider,
  url: Schema.String,
  place: Schema.NullOr(Schema.String).annotate({ description: "The channel or repository, such as web-team." }),
}).annotate({ identifier: "SessionLinks.Thread" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  tasks: Schema.Array(LinkedTask).annotate({
    description: "The tasks the chat worked on or created, that the caller can read. Oldest first.",
  }),
  pullRequests: Schema.Array(LinkedPullRequest).annotate({ description: "The pull requests those tasks link." }),
  issues: Schema.Array(Issue).annotate({ description: "The GitHub and Linear issues those tasks link." }),
  threads: Schema.Array(Thread).annotate({ description: "The channel threads that talk to the chat." }),
}).annotate({ identifier: "SessionLinks.Info" })
