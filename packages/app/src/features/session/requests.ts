export * as Requests from "./requests.js"

import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { QuestionnaireQuestion } from "@ren/ui/questionnaire"

export const permissionField = "permission"

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
  }
}

export function readPermissionReply(data: FormData) {
  const value = data.get(permissionField)
  return replies.find((reply) => reply === value)
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
