export * as Requests from "./requests.js"

import { type ChatState, Family, WebSearch } from "@ren/chat"
import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { QuestionnaireQuestion } from "@ren/ui/questionnaire"
import { SessionTitle } from "./session-title.js"

const sourceTitle = (state: ChatState.State, sessionID: string) =>
  SessionTitle.display(Family.childTitle(state, sessionID, ""), "Subagent")

export function live(state: ChatState.State, sessionID: string) {
  const permission = Family.permission(state, sessionID)
  const form = Family.form(state, sessionID)
  return {
    permission,
    permissionTitle: permission ? sourceTitle(state, permission.sessionID) : "",
    form,
    formTitle: form ? sourceTitle(state, form.sessionID) : "",
    connection: state.connection,
  }
}

export const permissionField = "permission"

export const permissionInstructionsField = "permission-instructions"

const replies: ReadonlyArray<Permission.Reply> = ["once", "always", "reject"]

export function permissionQuestion(request: Permission.Request): QuestionnaireQuestion {
  return {
    name: permissionField,
    title: `Allow ${request.action}?`,
    ...(request.resources.length > 0 && { detail: request.resources.join("\n") }),
    required: true,
    choices: [
      { value: "once", label: "Allow once" },
      {
        value: "always",
        label: "Allow always",
        ...(request.save && request.save.length > 0 && { description: request.save.join(", ") }),
      },
      { value: "reject", label: "Deny" },
    ],
    customAnswer: {
      name: permissionInstructionsField,
      label: "Deny and tell Ren what to do instead",
      placeholder: "Deny and tell Ren what to do instead…",
    },
  }
}

export function readPermissionReply(data: FormData): { reply: Permission.Reply; message?: string } | undefined {
  const typed = data.get(permissionInstructionsField)
  const message = typeof typed === "string" ? typed.trim() : ""
  if (message) return { reply: "reject", message }
  const value = data.get(permissionField)
  const reply = replies.find((item) => item === value)
  return reply && { reply }
}

type QuestionField = Form.StringField | Form.MultiselectField

const isQuestion = (field: Form.Field): field is QuestionField =>
  field.type === "string" || field.type === "multiselect"

export function formQuestions(form: Form.Info): ReadonlyArray<QuestionnaireQuestion> {
  return form.fields.filter(isQuestion).map((field) => ({
    name: field.key,
    title: field.description ?? field.title ?? form.title,
    required: field.required === true,
    multiple: field.type === "multiselect",
    choices: (field.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
    })),
    customAnswer:
      field.custom === false && (field.options ?? []).length > 0
        ? null
        : { label: "Type your own answer", placeholder: "Something else" },
  }))
}

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
