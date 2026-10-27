export * as GitHost from "./git-host.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"

export const Kind = Schema.Literals(["github"]).annotate({ identifier: "GitHost.Kind" })
export type Kind = typeof Kind.Type

// oxlint-disable-next-line ren/no-comments -- The credential label of each kind. The egress replaces ren:<LABEL> only on that kind's hosts.
export const label = (kind: Kind) => ({ github: "GITHUB" })[kind]

export const placeholder = (kind: Kind) => Credential.placeholder(label(kind))

// oxlint-disable-next-line ren/no-comments -- R11, R47: why a repository is not available. Each reason has one text.
export const Reason = Schema.Literals([
  "other_host",
  "not_repository",
  "unreachable",
  "no_credential",
  "no_egress",
  "no_access",
  "egress_refused",
  "missing_ref",
  "timeout",
  "answered",
]).annotate({ identifier: "GitHost.Reason" })
export type Reason = typeof Reason.Type

export interface Unavailable {
  readonly reason: Reason
  // oxlint-disable-next-line ren/no-comments -- The repository as people name it: owner/repo, or the URL when it has no such name.
  readonly name: string
  readonly detail?: string
}

export const message = (unavailable: Unavailable) => {
  const name = unavailable.name
  const detail = unavailable.detail ?? ""
  return {
    other_host: `Ren reads only repositories on ${detail}, not ${name}`,
    not_repository: `${name} is not the address of a repository: use https://${detail}/<owner>/<repo>`,
    unreachable: `Could not read ${name} from GitHub: ${detail}`,
    no_credential: `this space has no GitHub credential: install the GitHub App or sign in with GitHub, or ${name} does not exist`,
    no_egress: `this runtime has no egress, so Ren cannot read private repositories here, or ${name} does not exist`,
    no_access: `the GitHub App cannot read ${name}: add the repository to the installation, or ${name} does not exist`,
    egress_refused: `the egress refused the read of ${name}: ${detail}`,
    missing_ref: `The ref ${detail} is not in ${name}`,
    timeout: `GitHub did not answer within ${detail} for ${name}`,
    answered: `GitHub answered ${detail} for ${name}`,
  }[unavailable.reason]
}

export interface Repository extends Schema.Schema.Type<typeof Repository> {}
export const Repository = Schema.Struct({
  kind: Kind,
  url: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "GitHost.Repository" })

// oxlint-disable-next-line ren/no-comments -- R60: the repositories that an org can pick on one host. `installed` is false when the org has not connected the host (for GitHub: the GitHub App).
export interface Listing extends Schema.Schema.Type<typeof Listing> {}
export const Listing = Schema.Struct({
  kind: Kind,
  installed: Schema.Boolean,
  repositories: Schema.Array(Repository),
}).annotate({ identifier: "GitHost.Listing" })
