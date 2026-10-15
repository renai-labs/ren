export * as Policy from "./policy.js"

import { Schema } from "effect"

export const everywhere = "all"

export interface Statement extends Schema.Schema.Type<typeof Statement> {}
export const Statement = Schema.Struct({
  actions: Schema.Array(Schema.String).check(Schema.isNonEmpty()),
  roles: Schema.NonEmptyArray(Schema.String),
  on: Schema.String,
}).annotate({ identifier: "Policy.Statement" })

export interface Document extends Schema.Schema.Type<typeof Document> {}
export const Document = Schema.Struct({
  primitive: Schema.String,
  statements: Schema.Array(Statement),
})
  .check(
    Schema.makeFilter(
      (document) =>
        document.statements.every((statement) =>
          statement.actions.every((action) => action.startsWith(`${document.primitive}.`)),
        ) || `Every action must start with "${document.primitive}.".`,
    ),
  )
  .annotate({ identifier: "Policy.Document" })

const either = (words: ReadonlyArray<string>) =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.slice(-1).join("")}`

export const describe = (documents: ReadonlyArray<Document>) =>
  [
    ...documents.flatMap((document) => [
      document.primitive,
      ...document.statements.map((statement) => {
        const actions = statement.actions.map((action) => action.slice(document.primitive.length + 1))
        const scope = statement.on === everywhere ? "on all" : `when ${statement.on}`
        return `  ${either(statement.roles)} may ${either(actions)}, ${scope}`
      }),
      "",
    ]),
    "Anything not allowed is denied.",
  ].join("\n")

export const Documents = Schema.Array(Document)
  .check(
    Schema.makeFilter(
      (documents) =>
        new Set(documents.map((document) => document.primitive)).size === documents.length ||
        "Each primitive has one document.",
    ),
  )
  .annotate({ identifier: "Policy.Documents" })
