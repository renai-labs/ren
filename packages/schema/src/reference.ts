export * as Reference from "./reference.js"

import { Schema } from "effect"

export const Alias = Schema.String.check(
  Schema.isNonEmpty({ message: "Alias is required." }),
  Schema.isMaxLength(64, { message: "Use 64 characters or fewer." }),
  Schema.isPattern(/^[^/\\\s`,]+$/u, { message: "An alias has no slash, backslash, space, backtick or comma." }),
).annotate({ identifier: "Reference.Alias" })
export type Alias = typeof Alias.Type

export const Repository = Schema.String.check(
  Schema.isNonEmpty({ message: "Repository is required." }),
  Schema.isPattern(/^(?!file:)/iu, { message: "A local file: repository is not supported." }),
).annotate({ identifier: "Reference.Repository" })

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
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Reference.Info" })

export const List = Schema.Array(Info).annotate({ identifier: "Reference.List" })
export type List = typeof List.Type
