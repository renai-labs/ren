export * as PullRequest from "./pull-request.js"

import { Schema } from "effect"

export const State = Schema.Literals(["open", "draft", "merged", "closed"]).annotate({
  identifier: "PullRequest.State",
})
export type State = typeof State.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  url: Schema.String,
  number: Schema.Int,
  title: Schema.NullOr(Schema.String),
  state: Schema.NullOr(State),
}).annotate({
  identifier: "PullRequest.Info",
  description:
    "A GitHub pull request as GitHub shows it now. `title` and `state` are null when Ren cannot read it: no GitHub install, a repository outside the install, or GitHub did not answer.",
})
