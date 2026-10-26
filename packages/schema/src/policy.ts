export * as Policy from "./policy.js"

import { Schema } from "effect"

export const Effect = Schema.Literals(["allow", "deny"]).annotate({
  identifier: "Policy.Effect",
  description: "A deny rule wins over every allow rule that also matches.",
})
export type Effect = typeof Effect.Type

export interface Rule extends Schema.Schema.Type<typeof Rule> {}
export const Rule = Schema.Struct({
  actions: Schema.Array(Schema.String).check(Schema.isNonEmpty()),
  effect: Effect,
  roles: Schema.NonEmptyArray(Schema.String),
  when: Schema.Array(Schema.String).annotate({
    description:
      "Facts about the resource that must all hold, such as `space.member`. An empty list holds for every resource.",
  }),
}).annotate({ identifier: "Policy.Rule" })

export interface Document extends Schema.Schema.Type<typeof Document> {}
export const Document = Schema.Struct({
  resource: Schema.String,
  rules: Schema.Array(Rule),
})
  .check(
    Schema.makeFilter(
      (document) =>
        document.rules.every((rule) => rule.actions.every((action) => action.startsWith(`${document.resource}.`))) ||
        `Every action must start with "${document.resource}.".`,
    ),
  )
  .annotate({ identifier: "Policy.Document" })

const either = (words: ReadonlyArray<string>) =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.slice(-1).join("")}`

const both = (words: ReadonlyArray<string>) =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.slice(-1).join("")}`

export const describe = (documents: ReadonlyArray<Document>) =>
  [
    ...documents.flatMap((document) => [
      document.resource,
      ...document.rules.map((rule) => {
        const actions = rule.actions.map((action) => action.slice(document.resource.length + 1))
        const scope = rule.when.length === 0 ? "on all" : `when ${both(rule.when)}`
        return `  ${either(rule.roles)} ${rule.effect === "allow" ? "may" : "may never"} ${either(actions)}, ${scope}`
      }),
      "",
    ]),
    "A deny wins over an allow. Anything not allowed is denied.",
  ].join("\n")

export const Documents = Schema.Array(Document)
  .check(
    Schema.makeFilter(
      (documents) =>
        new Set(documents.map((document) => document.resource)).size === documents.length ||
        "Each resource has one document.",
    ),
  )
  .annotate({ identifier: "Policy.Documents" })
