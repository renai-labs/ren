import { describe, expect, test } from "bun:test"
import { Form } from "@ren/schema/form"
import { Schema } from "effect"
import { Requests } from "./requests.js"

const form = Schema.decodeUnknownSync(Form.Info)({
  id: "frm_1",
  sessionID: "ses_1",
  title: "Plan",
  fields: [
    { key: "scope", type: "string", title: "Scope", options: [{ value: "all", label: "All" }] },
    {
      key: "areas",
      type: "multiselect",
      title: "Areas",
      options: [
        { value: "ui", label: "UI" },
        { value: "api", label: "API" },
      ],
    },
    { key: "notes", type: "string", title: "Notes" },
    { key: "count", type: "number", title: "Count" },
  ],
})

const data = (entries: ReadonlyArray<readonly [string, string]>) =>
  entries.reduce((formData, entry) => {
    formData.append(entry[0], entry[1])
    return formData
  }, new FormData())

describe("form answers", () => {
  test("answers a single choice with one value, a multiple choice with all values, and leaves out blank answers", () => {
    expect(
      Requests.readFormAnswer(
        form,
        data([
          ["scope", "all"],
          ["areas", "ui"],
          ["areas", "api"],
          ["notes", "  "],
        ]),
      ),
    ).toEqual({ scope: "all", areas: ["ui", "api"] })
  })

  test("asks only the fields a choice list can answer, and lets a field without options take typed text", () => {
    const questions = Requests.formQuestions(form)
    expect(questions.map((question) => question.name)).toEqual(["scope", "areas", "notes"])
    expect(questions.at(2)?.customAnswer).toEqual({ label: "Type your own answer", placeholder: "Something else" })
  })
})

test("a permission reply is read only from the three known choices", () => {
  expect(Requests.readPermissionReply(data([[Requests.permissionField, "always"]]))).toEqual({ reply: "always" })
  expect(Requests.readPermissionReply(data([[Requests.permissionField, "everything"]]))).toBeUndefined()
})

test("typed instructions deny the request and tell Ren what to do instead, even when they spell a choice", () => {
  expect(
    Requests.readPermissionReply(data([[Requests.permissionInstructionsField, "  Use the staging database  "]])),
  ).toEqual({ reply: "reject", message: "Use the staging database" })
  expect(Requests.readPermissionReply(data([[Requests.permissionInstructionsField, "always"]]))).toEqual({
    reply: "reject",
    message: "always",
  })
  expect(Requests.readPermissionReply(data([[Requests.permissionInstructionsField, "   "]]))).toBeUndefined()
})

describe("web search request state", () => {
  const consent = Schema.decodeUnknownSync(Form.Info)({
    id: "frm_consent",
    sessionID: "ses_child",
    title: "Web Search",
    kind: "websearch.provider",
    fields: [{ key: "choice", type: "string", required: true, custom: false }],
  })
  const provider = Schema.decodeUnknownSync(Form.Info)({
    ...consent,
    id: "frm_provider",
    fields: [
      { key: "provider", type: "string", required: true, custom: false, options: [{ value: "exa", label: "Exa" }] },
    ],
  })
  const sending = { form: consent, owner: "ses_root", connection: 1 }

  test("holds the card across both forms and prevents duplicate submissions", () => {
    expect(Requests.webSearchRequest(sending, undefined, "ses_root", 1)).toEqual({ form: consent, sending: true })
    expect(Requests.webSearchRequest(undefined, provider, "ses_root", 1)).toEqual({ form: provider, sending: false })
  })

  test.each([
    ["navigate", "ses_other", 1],
    ["disconnect", "ses_root", 2],
  ] as const)("stops automatic replies on %s", (_, owner, connection) => {
    expect(Requests.webSearchRequest(sending, undefined, owner, connection)).toEqual({
      form: undefined,
      sending: false,
    })
  })

  test("keeps the selected provider after failure and retries only the provider form", () => {
    const failed = { owner: "ses_root", formID: consent.id, value: "exa", failed: true }
    expect(Requests.webSearchSelection(failed, "ses_root", provider, { sending: false })).toEqual({
      value: "exa",
      failed: true,
    })
  })

  test("a new consent form or another owner starts from any provider, unless the choice is still sending", () => {
    const chosen = { owner: "ses_root", formID: "frm_old", value: "exa", failed: true }
    expect(Requests.webSearchSelection(chosen, "ses_root", consent, { sending: false })).toEqual({
      value: "random",
      failed: false,
    })
    expect(Requests.webSearchSelection(chosen, "ses_root", consent, { sending: true })).toEqual({
      value: "exa",
      failed: true,
    })
    expect(Requests.webSearchSelection(chosen, "ses_other", provider, { sending: false })).toEqual({
      value: "random",
      failed: false,
    })
  })
})
