export * as OpenCodeActivity from "./activity.js"

import type { ToolEditor } from "@opencode/plugin/effect/tool"
import { Predicate, Schema, SchemaAST, Struct } from "effect"

export const field = "activity"

const description =
  "Always set this. For the person watching: what this call does for them, as a short present-tense phrase of 3 to 7 words, such as “Searching GitHub issues” or “Checking which tests fail”. Plain words: no code, paths, flags or tool names."

export const instruction =
  "Always fill the `activity` field of every tool call with a short present-tense phrase that tells the person what the call does for them, such as “Checking which tests fail”. The person sees this line while you work."

const isFields = (value: unknown): value is Schema.Struct.Fields =>
  Predicate.isObject(value) && Object.values(value).every(Schema.isSchema)

const jsonWithActivity = (input: unknown) => {
  if (!Predicate.isObject(input) || input.type !== "object") return
  const properties = Predicate.isObject(input.properties) ? input.properties : {}
  if (field in properties) return
  return { ...input, properties: { [field]: { type: "string", description }, ...properties } }
}

const withActivity = (input: unknown) => {
  if (!Schema.isSchema(input)) return jsonWithActivity(input)
  const fields = Predicate.hasProperty(input, "fields") ? input.fields : undefined
  if (!SchemaAST.isObjects(input.ast) || !isFields(fields) || field in fields) return
  return Schema.Struct({ [field]: Schema.optionalKey(Schema.String).annotate({ description }), ...fields })
}

// oxlint-disable-next-line ren/no-comments -- Every tool the model calls directly takes an optional plain-language line of what the call does, first, so the model writes it before the rest of the call; the transcript keeps it for the chat's live activity line, and the tool itself runs without it. Code Mode tools stay as they are: their signatures fill the system prompt, and the chat reads their app and action from the code of `execute`.
export const register = (editor: ToolEditor) => {
  for (const tool of editor.list()) {
    if (Predicate.isNotUndefined(tool.options?.namespace) || tool.options?.codemode === true) continue
    const input = withActivity(tool.input)
    if (!input) continue
    editor.update(tool.id, (found) => {
      const run = found.execute
      found.input = input
      found.execute = (value, context) => run(Predicate.isObject(value) ? Struct.omit(value, [field]) : value, context)
    })
  }
}

// oxlint-disable-next-line ren/no-comments -- Code Mode's `execute` joins the tool list per request, after every transform; it gets the same line here. It ignores keys it does not know, so the code runs as written.
export const request = (tools: Readonly<Record<string, { input: unknown }>>) => {
  for (const tool of Object.values(tools)) {
    const input = jsonWithActivity(tool.input)
    if (input) tool.input = input
  }
}
