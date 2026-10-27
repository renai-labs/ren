export * as Reference from "./reference.js"

import { Schema } from "effect"

export const Alias = Schema.String.check(
  Schema.isNonEmpty({ message: "Alias is required." }),
  Schema.isMaxLength(64, { message: "Use 64 characters or fewer." }),
  Schema.isPattern(/^[^/\\\s`,:]+$/u, {
    message: "An alias has no slash, backslash, space, backtick, comma or colon.",
  }),
).annotate({ identifier: "Reference.Alias" })
export type Alias = typeof Alias.Type

export const Repository = Schema.String.check(
  Schema.isNonEmpty({ message: "Repository is required." }),
  // oxlint-disable-next-line ren/no-comments -- R48: a host such as GitLab nests groups, so each git host decides how many path segments it accepts.
  Schema.isPattern(/^https:\/\/[^/\s]+(?:\/[^/\s]+){2,}$/u, {
    message: "Use the repository’s https://<host>/<owner>/<repo> address.",
  }),
).annotate({ identifier: "Reference.Repository" })

export const Description = Schema.String.check(Schema.isNonEmpty({ message: "Description is required." })).annotate({
  identifier: "Reference.Description",
  description: "What the repository holds. The agent sees a reference only through its description (R24).",
})

export const Branch = Schema.String.check(
  Schema.isPattern(/^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)[^\s~^:?*[\\]+(?<![/.])$/u, {
    message: "Use a valid git branch name.",
  }),
).annotate({ identifier: "Reference.Branch" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  alias: Alias,
  repository: Repository,
  branch: Schema.optionalKey(Branch),
  description: Description,
}).annotate({ identifier: "Reference.Info" })

export const List = Schema.Array(Info).annotate({ identifier: "Reference.List" })
export type List = typeof List.Type
