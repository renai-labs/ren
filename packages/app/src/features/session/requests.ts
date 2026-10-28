export * as Requests from "./requests.js"

import { WebSearch } from "@ren/chat"
import type { Form } from "@ren/schema/form"

export type QuestionField = Form.StringField | Form.MultiselectField

export const isQuestion = (field: Form.Field): field is QuestionField =>
  field.type === "string" || field.type === "multiselect"

export function readFormAnswer(form: Form.Info, data: FormData): Form.Answer {
  return Object.fromEntries(
    form.fields.filter(isQuestion).flatMap((field) => {
      const values = data
        .getAll(field.key)
        .flatMap((value) => (typeof value === "string" && value.trim() ? [value.trim()] : []))
      if (values.length === 0) return []
      return [[field.key, field.type === "multiselect" ? values : (values.at(0) ?? "")]]
    }),
  )
}

export interface WebSearchChoice {
  readonly owner: string
  readonly formID: string
  readonly value: string
  readonly failed: boolean
}

export interface WebSearchSending {
  readonly form: Form.Info
  readonly owner: string
  readonly connection: number
}

export function webSearchRequest(
  sending: WebSearchSending | undefined,
  live: Form.Info | undefined,
  owner: string,
  connection: number,
) {
  const held = sending?.owner === owner && sending.connection === connection ? sending.form : undefined
  return { form: held ?? live, sending: held !== undefined }
}

export function webSearchSelection(
  choice: WebSearchChoice | undefined,
  owner: string,
  form: Form.Info,
  request: { readonly sending: boolean },
) {
  const kept =
    choice?.owner === owner &&
    (choice.formID === form.id || request.sending || WebSearch.providerField(form) !== undefined)
  return kept ? { value: choice.value, failed: choice.failed } : { value: "random", failed: false }
}
